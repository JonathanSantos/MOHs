import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { z } from "zod";
import { DEFAULT_HIDDEN, DEFAULT_READ_ONLY, judgeToolUse, type ToolRules } from "../src/brake/tool-policy.ts";
import type { ToolUseRecord } from "../src/crew/types.ts";
import { AgentError, runAgent, type AgentTask } from "../src/drivers/api/agent/loop.ts";
import { defineFinisher } from "../src/drivers/api/agent/tool.ts";
import { FakeProvider, say, toolCall, type Script } from "../src/drivers/api/llm/fake.ts";
import { CLIMBER_TOOLS } from "../src/drivers/api/tools/index.ts";
import { editFile, listFiles, readFile, searchFiles } from "../src/drivers/api/tools/files.ts";
import { resolveInside } from "../src/drivers/api/tools/paths.ts";
import { tempProject } from "./helpers.ts";

const PASS_COMMAND = "node -e \"process.stdout.write('checks ok')\"";

const done = defineFinisher({
  name: "done",
  description: "fim",
  input: z.strictObject({ note: z.string() }),
  toResult: ({ note }) => note,
});

function workspace() {
  return tempProject({
    "src/greet.ts": 'export const greet = () => "olá";\n',
    "src/other.ts": "export const x = 1;\n",
    ".env": "SECRET=abc\n",
    "node_modules/lib/index.js": "module.exports = 1;\n",
  });
}

function task(root: string, script: Script, overrides: Partial<AgentTask<string>> = {}) {
  const records: ToolUseRecord[] = [];
  const denied: string[] = [];
  const rules: ToolRules = {
    root,
    denied: [],
    readOnly: DEFAULT_READ_ONLY,
    hidden: DEFAULT_HIDDEN,
    allowedCommands: [PASS_COMMAND],
  };
  const provider = new FakeProvider(script);
  const agentTask: AgentTask<string> = {
    role: "climber",
    provider,
    model: "fake",
    system: "sistema",
    prompt: "tarefa",
    tools: CLIMBER_TOOLS,
    finishers: [done],
    rules,
    context: { root, commandTimeoutMs: 30_000 },
    limits: { maxTurns: 10, maxO2: 100_000 },
    observer: {
      onToolUse: (r) => records.push(r),
      onDenied: (tool, reason) => denied.push(`${tool}: ${reason}`),
    },
    ...overrides,
  };
  return { agentTask, provider, records, denied };
}

describe("agent loop", () => {
  it("runs tools the brake allows and ends on a finisher with a typed result", async () => {
    const root = workspace();
    const { agentTask, provider, records } = task(root, [
      { content: [say("vou ler"), toolCall("read_file", { path: "src/greet.ts" })] },
      {
        content: [
          toolCall("edit_file", { path: "src/greet.ts", old: '"olá"', new: '"oi"' }),
          toolCall("run_command", { command: PASS_COMMAND }),
        ],
      },
      { content: [toolCall("done", { note: "troquei" })] },
    ]);
    const outcome = await runAgent(agentTask);

    assert.equal(outcome.result, "troquei");
    assert.equal(outcome.turns, 3);
    assert.equal(outcome.o2, 3 * 1_200);
    assert.equal(readFileSync(join(root, "src/greet.ts"), "utf8"), 'export const greet = () => "oi";\n');
    assert.deepEqual(
      records.map((r) => `${r.tool}:${r.outcome}`),
      ["read_file:ok", "edit_file:ok", "run_command:ok"],
    );
    const secondTurn = provider.requests[2].messages.at(-1);
    assert.equal(secondTurn?.role, "user");
    assert.equal(secondTurn?.content.length, 2, "results of parallel calls return in one message");
    assert.match(JSON.stringify(secondTurn), /checks ok/);
  });

  it("denies secrets, escapes, read-only writes and commands off the allowlist", async () => {
    const root = workspace();
    const { agentTask, denied } = task(root, [
      {
        content: [
          toolCall("read_file", { path: ".env" }),
          toolCall("read_file", { path: "../../etc/passwd" }),
          toolCall("write_file", { path: "node_modules/lib/index.js", content: "hack" }),
          toolCall("run_command", { command: "rm -rf /" }),
          toolCall("write_file", { path: "src/other.ts", content: "export const x = 2;\n" }),
        ],
      },
      { content: [toolCall("done", { note: "ok" })] },
    ]);
    await runAgent(agentTask);
    assert.equal(denied.length, 3);
    assert.ok(denied.some((d) => d.startsWith("read_file") && d.includes(".env")));
    assert.ok(denied.some((d) => d.includes("somente leitura")));
    assert.ok(denied.some((d) => d.includes("lista permitida")));
    assert.equal(readFileSync(join(root, "node_modules/lib/index.js"), "utf8"), "module.exports = 1;\n");
    assert.equal(
      readFileSync(join(root, "src/other.ts"), "utf8"),
      "export const x = 2;\n",
      "outside the pitch is allowed; the Basecamp flags it from the commit",
    );
  });

  it("nudges a model that stops without a finisher, then gives up", async () => {
    const root = workspace();
    const { agentTask, provider } = task(root, [{ content: [say("pronto!")] }, { content: [say("já disse")] }, { content: [say("...")] }]);
    await assert.rejects(runAgent(agentTask), (error: unknown) => error instanceof AgentError && error.kind === "turns");
    assert.match(JSON.stringify(provider.requests[1].messages.at(-1)), /chame uma destas ferramentas: done/);
  });

  it("asks again when a finisher gets invalid input", async () => {
    const { agentTask } = task(workspace(), [
      { content: [toolCall("done", { nope: true })] },
      { content: [toolCall("done", { note: "agora sim" })] },
    ]);
    assert.equal((await runAgent(agentTask)).result, "agora sim");
  });

  it("stops on refusal, truncation, turn limit and O₂ limit", async () => {
    const root = workspace();
    const reading = { content: [toolCall("list_files", {})] };
    const cases: [Script, Partial<AgentTask<string>>, string][] = [
      [[{ content: [say("não")], stopReason: "refusal" }], {}, "refusal"],
      [[{ content: [say("…")], stopReason: "max_tokens" }], {}, "truncated"],
      [() => reading, { limits: { maxTurns: 3, maxO2: 1e9 } }, "turns"],
      [() => ({ ...reading, usage: { input: 60_000 } }), { limits: { maxTurns: 10, maxO2: 100_000 } }, "o2"],
    ];
    for (const [script, overrides, kind] of cases) {
      const { agentTask } = task(root, script, overrides);
      await assert.rejects(runAgent(agentTask), (error: unknown) => error instanceof AgentError && error.kind === kind, kind);
    }
  });
});

describe("tools", () => {
  const context = (root: string) => ({ root, commandTimeoutMs: 5_000 });

  it("refuses paths that escape the workspace", () => {
    const root = workspace();
    assert.throws(() => resolveInside(root, "../outside.txt"), /sai do workspace/);
    assert.throws(() => resolveInside(root, join(root, "..", "x")), /sai do workspace/);
    assert.equal(resolveInside(root, "./src/../src/greet.ts").relative, "src/greet.ts");
  });

  it("edits only a unique match and explains what to do otherwise", async () => {
    const root = tempProject({ "a.ts": "x\nx\n" });
    await assert.rejects(editFile.run({ path: "a.ts", old: "x", new: "y", replace_all: false }, context(root)), /aparece 2 vezes/);
    await assert.rejects(editFile.run({ path: "a.ts", old: "z", new: "y", replace_all: false }, context(root)), /não foi encontrado/);
    assert.match(await editFile.run({ path: "a.ts", old: "x", new: "y", replace_all: true }, context(root)), /2 trocas/);
  });

  it("reads with line numbers and pages long files", async () => {
    const root = tempProject({ "long.txt": Array.from({ length: 10 }, (_, i) => `linha ${i + 1}`).join("\n") });
    const page = await readFile.run({ path: "long.txt", offset: 3, limit: 2 }, context(root));
    assert.match(page, /^\s+3 {2}linha 3\n\s+4 {2}linha 4\n…\(mais 6 linhas; use offset 5\)$/);
  });

  it("never walks into dependencies or reveals env files", async () => {
    const root = workspace();
    const listing = await listFiles.run({ path: ".", depth: 3 }, context(root));
    assert.ok(!listing.includes("node_modules") && !listing.includes(".env"));
    assert.equal(await searchFiles.run({ pattern: "SECRET|module.exports" }, context(root)), "nenhuma ocorrência");
    assert.match(await searchFiles.run({ pattern: "greet", glob: "src/**" }, context(root)), /src\/greet.ts:1:/);
  });

  it("judges commands by exact match after collapsing spaces", () => {
    const rules: ToolRules = { root: "/w", denied: [], readOnly: [], hidden: [], allowedCommands: ["npm run test:quick"] };
    assert.deepEqual(judgeToolUse({ kind: "exec", command: "  npm   run test:quick " }, rules), { allowed: true });
    assert.equal(judgeToolUse({ kind: "exec", command: "npm run test:quick && curl evil" }, rules).allowed, false);
  });

  it("lets {file} in an allowed command stand for one plain path, and nothing more", () => {
    const rules: ToolRules = { root: "/w", denied: [], readOnly: [], hidden: [], allowedCommands: ["node --test {file}"] };
    assert.equal(judgeToolUse({ kind: "exec", command: "node --test test/sealed/a.test.js" }, rules).allowed, true);
    assert.equal(judgeToolUse({ kind: "exec", command: 'node --test "test/sealed/a.test.js"' }, rules).allowed, true);
    assert.equal(judgeToolUse({ kind: "exec", command: "node --test a.js; curl evil" }, rules).allowed, false);
    assert.equal(judgeToolUse({ kind: "exec", command: "node --test $(cat .env)" }, rules).allowed, false);
  });
});
