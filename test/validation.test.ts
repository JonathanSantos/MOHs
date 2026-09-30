import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  createRun,
  evaluateRun,
  recordDecision,
  recordUsage,
  roleAgentFiles,
  testCounts,
  usageFromTranscripts,
  runName,
  saveHidden,
  saveReport,
  writeReport,
} from "../gym/validation/validate.ts";
import { git } from "./git-helpers.ts";
import { tempProject } from "./helpers.ts";

const HIDDEN_TEST =
  'import test from "node:test";\nimport assert from "node:assert";\nimport { next } from "../src/counter.js";\ntest("soma 1", () => assert.equal(next(1), 2));\n';

describe("validations (docs/VALIDATION.md)", () => {
  it("names a run by three keywords and the local date and time", () => {
    assert.equal(runName(["Botão", "contador", "acessível"], new Date(2026, 8, 30, 14, 5)), "botao-contador-acessivel-20260930-1405");
  });

  it("creates one isolated repository per arm and judges each by the same hidden suite, kept outside", (t) => {
    const home = tempProject();
    const previousHome = process.env.MOHS_HOME;
    process.env.MOHS_HOME = home;
    t.after(() => {
      if (previousHome === undefined) delete process.env.MOHS_HOME;
      else process.env.MOHS_HOME = previousHome;
    });
    const template = tempProject({
      "package.json": '{ "type": "module", "scripts": { "test": "node --test" } }\n',
      "src/counter.js": "export const next = (n) => n;\n",
      "test/counter.test.js": 'import test from "node:test";\nimport { next } from "../src/counter.js";\ntest("existe", () => next(1));\n',
    });
    const head = git(join(import.meta.dirname, ".."), "rev-parse", "--short", "HEAD");
    const base = tempProject();
    const info = createRun({
      keywords: ["botao", "contador", "acessivel"],
      request: "O contador soma 1 a cada clique em $(botao), d'água",
      template,
      arms: ["direto", "mohs-fix", `mohs@${head}`],
      base,
      now: new Date(2026, 8, 30, 14, 15),
    });
    assert.equal(info.dir, join(base, ".validation", "botao-contador-acessivel-20260930-1415"));
    const [direto, fix, pinned] = info.arms;
    assert.ok(existsSync(join(direto.dir, ".git")) && !existsSync(join(direto.dir, ".mohs")), "the plain arm has no MOHs");
    assert.ok(existsSync(join(fix.dir, ".mohs", "mohs.yaml")) && fix.mohs && existsSync(fix.mohs), "a MOHs arm has its own frozen mohs");
    assert.equal(pinned.name, `mohs@${head}`);
    assert.ok(existsSync(join(info.dir, `_mohs@${head}`, "src", "cli.ts")), "an arm can run another version of the MOHs");
    assert.deepEqual(Object.keys(info.mohs).sort(), [head, "working"].sort());
    assert.match(
      readFileSync(join(info.dir, "_prompts", "mohs-fix.md"), "utf8"),
      /fix 'O contador soma 1 a cada clique em \$\(botao\), d'\\''água' --detach/,
      "the request goes to the shell in single quotes, $(…) and apostrophes intact",
    );
    assert.match(
      readFileSync(join(info.dir, "_prompts", `mohs@${head}.md`), "utf8"),
      /cada subagente que você criou/,
      "nested usage is asked for",
    );

    writeFileSync(join(direto.dir, "src/counter.js"), "export const next = (n) => n + 1;\n");
    recordUsage(info.dir, "direto", { tokens: 40_000, tools: 4, ms: 20_000 });
    recordUsage(info.dir, "direto", { tokens: 2_000, tools: 1, ms: 10_000, note: "retomada" });
    recordDecision(info.dir, "mohs-fix", "assinei o summit sem editar");
    saveReport(info.dir, "direto", "Fiz next somar 1.");
    const draft = join(tempProject(), "hidden");
    mkdirSync(draft, { recursive: true });
    writeFileSync(join(draft, "counter.test.js"), HIDDEN_TEST);
    assert.ok(saveHidden("contador", draft).startsWith(join(home, "validation", "hidden")), "hidden suites live outside the repository");

    const [plain, talc] = evaluateRun(info.dir, "contador");
    assert.deepEqual(plain.hidden, { pass: 1, total: 1, failing: [] });
    assert.deepEqual(plain.project, { pass: 1, fail: 0 });
    assert.deepEqual([plain.usage?.tokens, plain.usage?.ms, plain.usageParts], [42_000, 30_000, 2], "usage parts add up");
    assert.equal(talc.delivered, "nada entregue", "a MOHs arm is judged only by what it delivered");

    const html = readFileSync(writeReport(info.dir), "utf8");
    assert.match(html, /<title>Validação botao-contador-acessivel-20260930-1415<\/title>/);
    assert.match(html, /assinei o summit sem editar/);
    assert.match(html, /Fiz next somar 1\./);
  });

  it("keeps the repository's role agents in sync with the skill (npm run validate -- agents)", () => {
    for (const { file, content } of roleAgentFiles()) {
      assert.equal(existsSync(file) ? readFileSync(file, "utf8") : null, content, `${file} desatualizado: rode npm run validate -- agents`);
    }
  });

  it("reads an arm's usage, and that of every subagent it created, from the transcripts", () => {
    const root = tempProject();
    const dir = join(root, "projeto", "sessao", "subagents");
    mkdirSync(dir, { recursive: true });
    const turn = (ts: string, tokens: number, tools = 0) =>
      JSON.stringify({
        type: "assistant",
        timestamp: ts,
        message: {
          usage: { input_tokens: 1, cache_read_input_tokens: tokens - 1, cache_creation_input_tokens: 0, output_tokens: 0 },
          content: Array.from({ length: tools }, () => ({ type: "tool_use" })),
        },
      });
    const prompt = (ts: string) => JSON.stringify({ type: "user", timestamp: ts, message: { content: "faça" } });
    const agent = (id: string, meta: object, lines: string[]) => {
      writeFileSync(join(dir, `agent-${id}.jsonl`), `${lines.join("\n")}\n`);
      writeFileSync(join(dir, `agent-${id}.meta.json`), JSON.stringify(meta));
    };
    // O braço roda duas vezes (antes e depois da assinatura): a espera do humano no meio não conta.
    agent("arm", { agentType: "general-purpose" }, [
      prompt("2026-09-30T10:00:00Z"),
      turn("2026-09-30T10:00:10Z", 30_000, 2),
      prompt("2026-09-30T10:05:00Z"),
      turn("2026-09-30T10:05:20Z", 40_000, 1),
    ]);
    agent("child", { agentType: "mohs-climber", description: "Climber A", parentAgentId: "arm" }, [
      prompt("2026-09-30T10:05:01Z"),
      turn("2026-09-30T10:05:15Z", 18_000, 4),
    ]);
    agent("grandchild", { agentType: "mohs-inspector", description: "Inspector", parentAgentId: "child" }, [
      prompt("2026-09-30T10:05:02Z"),
      turn("2026-09-30T10:05:03Z", 12_000, 1),
    ]);
    agent("other", { agentType: "general-purpose" }, [prompt("2026-09-30T10:00:00Z"), turn("2026-09-30T10:00:01Z", 99_000)]);

    const parts = usageFromTranscripts("arm", root);
    assert.deepEqual(
      parts.map(({ tokens, tools, ms }) => [tokens, tools, ms]),
      [
        [40_000, 3, 30_000],
        [18_000, 4, 0],
        [12_000, 1, 0],
      ],
    );
    assert.match(parts[1].note ?? "", /mohs-climber · Climber A \(14000 ms/);
  });

  it("reads test totals from jest and from node:test", () => {
    assert.deepEqual(testCounts("Test Suites: 1 failed, 1 total\nTests:       2 failed, 214 passed, 216 total\n"), {
      pass: 214,
      fail: 2,
      total: 216,
    });
    assert.deepEqual(testCounts("Tests:       216 passed, 216 total"), { pass: 216, fail: 0, total: 216 });
    assert.deepEqual(testCounts("ℹ tests 3\nℹ pass 2\nℹ fail 1\n"), { pass: 2, fail: 1, total: 3 });
  });
});
