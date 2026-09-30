import { sleep } from "../../../util/runtime.ts";
import {
  ProviderError,
  type AssistantBlock,
  type CompletionRequest,
  type CompletionResponse,
  type Message,
  type ModelProvider,
  type StopReason,
} from "./types.ts";

/**
 * Chat Completions wire format, used by providers that expose an OpenAI-compatible endpoint
 * (Moonshot/Kimi and others). Only the fields MOHs reads are typed.
 */
interface WireToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

type WireMessage =
  | { role: "system" | "user"; content: string }
  | { role: "assistant"; content: string | null; tool_calls?: WireToolCall[] }
  | { role: "tool"; tool_call_id: string; content: string };

interface WireResponse {
  model?: string;
  choices: { message: { content: string | null; tool_calls?: WireToolCall[] }; finish_reason: string | null }[];
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    prompt_tokens_details?: { cached_tokens?: number };
    cached_tokens?: number;
  };
}

export interface OpenAICompatibleOptions {
  name: string;
  baseUrl: string;
  apiKey: string;
  maxRetries?: number;
  fetch?: typeof fetch;
}

const FINISH_REASONS: Record<string, StopReason> = {
  stop: "end_turn",
  tool_calls: "tool_use",
  length: "max_tokens",
  content_filter: "refusal",
};
const RETRYABLE_STATUS = new Set([408, 409, 429, 500, 502, 503, 504]);

export class OpenAICompatibleProvider implements ModelProvider {
  readonly name: string;
  private readonly options: OpenAICompatibleOptions;

  constructor(options: OpenAICompatibleOptions) {
    this.name = options.name;
    this.options = options;
  }

  async complete(request: CompletionRequest): Promise<CompletionResponse> {
    const body = {
      model: request.model,
      max_tokens: request.maxTokens,
      messages: [{ role: "system", content: request.system } satisfies WireMessage, ...request.messages.flatMap(toWireMessages)],
      tools: request.tools.map((tool) => ({
        type: "function",
        function: { name: tool.name, description: tool.description, parameters: tool.inputSchema },
      })),
    };
    const data = await this.post(body);
    const choice = data.choices[0];
    if (!choice) throw new ProviderError(`${this.name}: resposta sem choices`, true);

    const wire = choice.message;
    const cached = data.usage?.prompt_tokens_details?.cached_tokens ?? data.usage?.cached_tokens ?? 0;
    return {
      message: {
        role: "assistant",
        content: toAssistantBlocks(wire),
        native: { role: "assistant", content: wire.content, tool_calls: wire.tool_calls },
      },
      stopReason: FINISH_REASONS[choice.finish_reason ?? ""] ?? "other",
      usage: {
        input: (data.usage?.prompt_tokens ?? 0) - cached,
        output: data.usage?.completion_tokens ?? 0,
        cacheRead: cached,
        cacheWrite: 0,
      },
      model: data.model ?? request.model,
    };
  }

  private async post(body: unknown): Promise<WireResponse> {
    const doFetch = this.options.fetch ?? fetch;
    const maxRetries = this.options.maxRetries ?? 4;
    for (let attempt = 0; ; attempt++) {
      let response: Response;
      try {
        response = await doFetch(`${this.options.baseUrl.replace(/\/$/, "")}/chat/completions`, {
          method: "POST",
          headers: { "content-type": "application/json", authorization: `Bearer ${this.options.apiKey}` },
          body: JSON.stringify(body),
        });
      } catch (error) {
        if (attempt < maxRetries) {
          await sleep(backoffMs(attempt));
          continue;
        }
        throw new ProviderError(`${this.name}: falha de conexão`, true, { cause: error });
      }
      if (response.ok) return (await response.json()) as WireResponse;
      if (RETRYABLE_STATUS.has(response.status) && attempt < maxRetries) {
        await sleep(backoffMs(attempt));
        continue;
      }
      const detail = (await response.text()).slice(0, 300);
      if (response.status === 401 || response.status === 403)
        throw new ProviderError(`${this.name} recusou a chave de API (${response.status}).`, false);
      throw new ProviderError(`${this.name} ${response.status}: ${detail}`, RETRYABLE_STATUS.has(response.status));
    }
  }
}

function toWireMessages(message: Message): WireMessage[] {
  if (message.role === "assistant") return [message.native as WireMessage];
  const text = message.content.filter((b) => b.type === "text").map((b) => b.text);
  const results = message.content.flatMap((b) =>
    b.type === "tool_result"
      ? [{ role: "tool" as const, tool_call_id: b.callId, content: b.isError ? `ERRO: ${b.content}` : b.content }]
      : [],
  );
  return [...results, ...(text.length ? [{ role: "user" as const, content: text.join("\n\n") }] : [])];
}

function toAssistantBlocks(message: { content: string | null; tool_calls?: WireToolCall[] }): AssistantBlock[] {
  const blocks: AssistantBlock[] = message.content ? [{ type: "text", text: message.content }] : [];
  for (const call of message.tool_calls ?? [])
    blocks.push({ type: "tool_call", id: call.id, name: call.function.name, input: parseArguments(call.function.arguments) });
  return blocks;
}

/** Arguments arrive as a JSON string; an unparsable one is passed through so the tool reports a schema error. */
function parseArguments(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return { __unparsable__: raw };
  }
}

function backoffMs(attempt: number): number {
  return Math.min(8_000, 500 * 2 ** attempt) + Math.floor(Math.random() * 250);
}
