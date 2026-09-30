import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { AnthropicProvider } from "../src/drivers/api/llm/anthropic.ts";
import { OpenAICompatibleProvider } from "../src/drivers/api/llm/openai-compatible.ts";
import { parseModelRef, ProviderRegistry } from "../src/drivers/api/llm/registry.ts";
import { o2Of, type CompletionRequest } from "../src/drivers/api/llm/types.ts";
import { jsonServer } from "./http-helpers.ts";
import { load, tempProject } from "./helpers.ts";

const TOOL = {
  name: "read_file",
  description: "lê",
  inputSchema: { type: "object", properties: { path: { type: "string" } }, required: ["path"] },
};

function request(overrides: Partial<CompletionRequest> = {}): CompletionRequest {
  return {
    model: "m",
    system: "instruções estáveis",
    messages: [{ role: "user", content: [{ type: "text", text: "tarefa" }] }],
    tools: [TOOL],
    maxTokens: 1000,
    ...overrides,
  };
}

describe("model references and registry", () => {
  it("reads provider/model, defaulting bare ids to anthropic", () => {
    assert.deepEqual(parseModelRef("moonshot/kimi-k2.7-code"), { provider: "moonshot", model: "kimi-k2.7-code" });
    assert.deepEqual(parseModelRef("claude-sonnet-5-5"), { provider: "anthropic", model: "claude-sonnet-5-5" });
  });

  it("reports missing credentials and unknown providers before a climb starts", () => {
    const settings = load(tempProject()).settings;
    const refs = ["moonshot/kimi-k2.7-code", "nowhere/x", "claude-sonnet-5-5"];
    const bare = new ProviderRegistry(settings, { env: {}, anthropicProfileDirs: [] }).checkCredentials(refs);
    assert.equal(bare.length, 3);
    assert.ok(bare.some((p) => p.includes("MOONSHOT_API_KEY")));
    assert.ok(bare.some((p) => p.includes('"nowhere"')));
    assert.ok(bare.some((p) => p.includes("ant auth login")));

    const withProfile = new ProviderRegistry(settings, { env: {}, anthropicProfileDirs: [tempProject()] }).checkCredentials(refs);
    assert.equal(withProfile.length, 2, "an `ant auth login` profile counts as Anthropic credentials");
  });

  it("counts cache reads at a tenth of their size in O₂", () => {
    assert.equal(o2Of({ input: 100, output: 50, cacheRead: 1000, cacheWrite: 20 }), 270);
  });
});

describe("Anthropic provider (SDK against a local server)", () => {
  it("caches the system prompt, sets effort and the refusal fallback, and replays its own content", async (t) => {
    const server = await jsonServer(() => ({
      status: 200,
      body: {
        id: "msg_1",
        type: "message",
        role: "assistant",
        model: "claude-sonnet-5-5",
        content: [
          { type: "text", text: "vou ler" },
          { type: "tool_use", id: "toolu_1", name: "read_file", input: { path: "a.ts" } },
        ],
        stop_reason: "tool_use",
        stop_sequence: null,
        usage: { input_tokens: 100, output_tokens: 20, cache_creation_input_tokens: 50, cache_read_input_tokens: 400 },
      },
    }));
    t.after(() => server.close());
    const provider = new AnthropicProvider({ apiKey: "test-key", baseURL: server.url, effort: "medium", fallbacks: true, maxRetries: 0 });

    const first = await provider.complete(request({ model: "claude-sonnet-5-5" }));
    assert.equal(first.stopReason, "tool_use");
    assert.deepEqual(first.usage, { input: 100, output: 20, cacheRead: 400, cacheWrite: 50 });
    assert.deepEqual(first.message.content[1], { type: "tool_call", id: "toolu_1", name: "read_file", input: { path: "a.ts" } });

    const sent = server.requests[0];
    assert.deepEqual(sent.body.system, [{ type: "text", text: "instruções estáveis", cache_control: { type: "ephemeral" } }]);
    assert.deepEqual(sent.body.cache_control, { type: "ephemeral" });
    assert.deepEqual(sent.body.output_config, { effort: "medium" });
    assert.equal(sent.body.fallbacks, "default");
    assert.match(String(sent.headers["anthropic-beta"]), /server-side-fallback-2026-07-01/);
    assert.equal(sent.body.tool_choice, undefined);
    assert.deepEqual(sent.body.tools[0].input_schema, TOOL.inputSchema);

    await provider.complete(
      request({
        model: "claude-sonnet-5-5",
        messages: [
          { role: "user", content: [{ type: "text", text: "tarefa" }] },
          first.message,
          { role: "user", content: [{ type: "tool_result", callId: "toolu_1", content: "conteúdo" }] },
        ],
      }),
    );
    const replay = server.requests[1].body.messages;
    assert.deepEqual(replay[1].content, first.message.native, "assistant turn must be replayed byte for byte");
    assert.deepEqual(replay[2].content[0], { type: "tool_result", tool_use_id: "toolu_1", content: "conteúdo", is_error: false });
  });

  it("maps a refusal and turns authentication errors into a clear message", async (t) => {
    const server = await jsonServer((_req, index) =>
      index === 0
        ? {
            status: 200,
            body: {
              id: "m",
              type: "message",
              role: "assistant",
              model: "x",
              content: [],
              stop_reason: "refusal",
              stop_sequence: null,
              usage: { input_tokens: 1, output_tokens: 0 },
            },
          }
        : { status: 401, body: { type: "error", error: { type: "authentication_error", message: "bad key" } } },
    );
    t.after(() => server.close());
    const provider = new AnthropicProvider({ apiKey: "k", baseURL: server.url, effort: "low", fallbacks: false, maxRetries: 0 });
    assert.equal((await provider.complete(request())).stopReason, "refusal");
    assert.equal(server.requests[0].body.fallbacks, undefined);
    await assert.rejects(provider.complete(request()), /ANTHROPIC_API_KEY/);
  });
});

describe("OpenAI-compatible provider (Kimi and others)", () => {
  it("maps tools and tool results to chat completions and retries a rate limit", async (t) => {
    const server = await jsonServer((_req, index) =>
      index === 0
        ? { status: 429, body: { error: "slow down" } }
        : {
            status: 200,
            body: {
              model: "kimi-k2.7-code",
              choices: [
                {
                  finish_reason: "tool_calls",
                  message: {
                    content: null,
                    tool_calls: [{ id: "c1", type: "function", function: { name: "read_file", arguments: '{"path":"a.ts"}' } }],
                  },
                },
              ],
              usage: { prompt_tokens: 300, completion_tokens: 40, prompt_tokens_details: { cached_tokens: 200 } },
            },
          },
    );
    t.after(() => server.close());
    const provider = new OpenAICompatibleProvider({ name: "moonshot", baseUrl: `${server.url}/v1`, apiKey: "sk-test", maxRetries: 2 });

    const first = await provider.complete(request({ model: "kimi-k2.7-code" }));
    assert.equal(server.requests.length, 2, "the 429 is retried");
    assert.equal(first.stopReason, "tool_use");
    assert.deepEqual(first.usage, { input: 100, output: 40, cacheRead: 200, cacheWrite: 0 });
    assert.deepEqual(first.message.content, [{ type: "tool_call", id: "c1", name: "read_file", input: { path: "a.ts" } }]);

    const sent = server.requests[1];
    assert.equal(sent.url, "/v1/chat/completions");
    assert.equal(sent.headers.authorization, "Bearer sk-test");
    assert.deepEqual(sent.body.messages[0], { role: "system", content: "instruções estáveis" });
    assert.deepEqual(sent.body.tools[0], {
      type: "function",
      function: { name: "read_file", description: "lê", parameters: TOOL.inputSchema },
    });

    await provider.complete(
      request({
        messages: [
          { role: "user", content: [{ type: "text", text: "tarefa" }] },
          first.message,
          { role: "user", content: [{ type: "tool_result", callId: "c1", content: "conteúdo" }] },
        ],
      }),
    );
    const replay = server.requests[2].body.messages;
    assert.equal(replay[2].tool_calls[0].id, "c1");
    assert.deepEqual(replay[3], { role: "tool", tool_call_id: "c1", content: "conteúdo" });
  });
});
