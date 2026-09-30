import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  createRun,
  evaluateRun,
  recordDecision,
  recordUsage,
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
      request: "O contador soma 1 a cada clique",
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
    assert.match(readFileSync(join(info.dir, "_prompts", "mohs-fix.md"), "utf8"), /fix "O contador soma 1 a cada clique" --detach/);
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
});
