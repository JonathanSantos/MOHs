import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { describe, it } from "node:test";
import { readEvents } from "../src/basecamp/event-log.ts";
import { resolveClimbDir } from "../src/cli/climb-dir.ts";
import { agentClimb, mohs, useMohsBin, workDir } from "./agent-helpers.ts";
import { git, gitProject } from "./git-helpers.ts";

const ANCHOR = "node --test";
const REQUEST = "Trocar a saudação para oi";

function project(): string {
  return gitProject({
    "package.json": '{ "type": "module" }\n',
    "src/greet.js": 'export const greet = () => "olá";\n',
    "test/greet.test.js":
      'import test from "node:test";\nimport assert from "node:assert";\nimport { greet } from "../src/greet.js";\ntest("greet", () => assert.ok(greet()));\n',
    ".gitignore": ".mohs/\n",
    ".mohs/mohs.yaml": `commands:\n  anchor: [${JSON.stringify(ANCHOR)}]\n`,
  });
}

function write(dir: string, path: string, content: string): void {
  mkdirSync(dirname(join(dir, path)), { recursive: true });
  writeFileSync(join(dir, path), content);
}

describe("talc: a small fix without plan or line", () => {
  useMohsBin();

  it("goes straight to the climber and asks the human to sign the diff and the decisions at the end", async (t) => {
    const root = project();
    const id = "20260930-0200-talc";
    const climb = agentClimb(root, t, id, REQUEST, "talc");
    const running = climb.run();

    const climber = await mohs(root, "next");
    assert.match(climber.out, /MOHs · tarefa T1 · climber · route A · pitch 1/, "the first task is the climber's");
    assert.match(climber.out, /Hardness talc: correção pequena/);
    assert.match(climber.out, /Pedido: Trocar a saudação para oi/);
    assert.match(climber.out, /• escalate:/, "the climber may ask for the full flow");
    assert.doesNotMatch(climber.out, /• watch:/, "there is no line to doubt");
    write(workDir(climber.out), "src/greet.js", 'export const greet = () => "oi";\n');

    const answer = { summary: "greet() devolve oi", decisions: ["mantive a exportação nomeada", "sem tradução por idioma"] };
    const signing = await mohs(root, "call", "safe", JSON.stringify(answer));
    assert.match(signing.out, /e 2 decisões/);
    assert.match(signing.out, /A correção e as decisões do climber espera a assinatura humana/);
    await mohs(root, "sign", "summit-A");

    const view = await running;
    assert.equal(view.state, "done", JSON.stringify(view.errors));
    const types = readEvents(climb.logFile).map((event) => event.type);
    for (const skipped of ["line.started", "bolts.started", "seal.started", "inspection.started", "descent.started"] as const)
      assert.ok(!types.includes(skipped), `talc has no ${skipped}`);
    assert.deepEqual(view.routes[0].decisions, answer.decisions);
    assert.equal(view.routes[0].evidence?.grade, "média", "the project's own tests ran");
    assert.equal(git(root, "show", `mohs/${id}/A:src/greet.js`), 'export const greet = () => "oi";');
    assert.equal(readFileSync(join(root, "src/greet.js"), "utf8"), 'export const greet = () => "olá";\n', "the working copy is untouched");
  });

  it("stops and points to the full flow when the climber escalates", async (t) => {
    const root = project();
    const id = "20260930-0201-talc";
    const running = agentClimb(root, t, id, REQUEST, "talc").run();
    await mohs(root, "next");
    const escalated = await mohs(root, "call", "escalate", "a saudação vem de um arquivo de traduções em 5 idiomas");
    assert.match(escalated.out, /A correção pediu o fluxo completo/);
    assert.match(escalated.out, new RegExp(`mohs climb --from ${id} --detach`));
    const view = await running;
    assert.equal(view.state, "escalated");
    assert.match(view.escalation ?? "", /traduções/);

    // No mesmo minuto da correção, e antes dela na ordem dos ids: o padrão sem --climb tem de ser o que começou por último.
    const next = "20260930-0201-full";
    const full = await mohs(
      root,
      "climb",
      "--from",
      id,
      "--id",
      next,
      "--crew",
      "fake",
      "--scenario",
      "quick-fix",
      "--speed",
      "1000",
      "--auto-sign",
      "--no-lookout",
      "--exit",
    );
    assert.equal(full.code, 0, full.out);
    const started = readEvents(join(root, ".mohs", "climbs", next, "events.jsonl")).find((event) => event.type === "climb.started");
    const request = started?.type === "climb.started" ? started.data.request : "";
    assert.match(request, /^Trocar a saudação para oi\n\n\(Veio da correção 20260930-0201-talc, que pediu o fluxo completo: .*traduções/);
    assert.equal(basename(resolveClimbDir(root) ?? ""), next);
  });

  it("escalates by itself when the fix touches sensitive code, whatever the climber thought", async (t) => {
    const root = project();
    const id = "20260930-0202-talc";
    const running = agentClimb(root, t, id, REQUEST, "talc").run();
    const climber = await mohs(root, "next");
    write(workDir(climber.out), "src/auth/session.js", "export const ttl = 60;\n");
    const out = await mohs(root, "call", "safe", "ajustei o ttl da sessão");
    assert.match(out.out, /A correção pediu o fluxo completo/);
    assert.match(out.out, /src\/auth\/session\.js, que é área sensível/);
    const view = await running;
    assert.equal(view.state, "escalated");
    const escalated = readEvents(join(root, ".mohs", "climbs", id, "events.jsonl")).find((event) => event.type === "climb.escalated");
    assert.equal(escalated?.actor, "basecamp");
  });

  it("counts only code toward the talc bounds: tests and documentation keep a fix small", async (t) => {
    const root = project();
    const id = "20260930-0203-talc";
    const running = agentClimb(root, t, id, REQUEST, "talc").run();
    const climber = await mohs(root, "next");
    const work = workDir(climber.out);
    assert.match(climber.out, /mais de 3 arquivos de código \(testes e documentação não contam\)/);
    write(work, "src/greet.js", 'export const greet = () => "oi";\n');
    write(work, "src/farewell.js", 'export const farewell = () => "tchau";\n');
    write(work, "src/index.js", 'export * from "./greet.js";\nexport * from "./farewell.js";\n');
    write(work, "test/farewell.test.js", 'import test from "node:test";\ntest("existe", () => {});\n');
    write(work, "README.md", "# Saudação\n\nAgora diz oi.\n");
    write(work, "docs/saudacao.md", "Como a saudação funciona.\n");
    const out = await mohs(root, "call", "safe", "saudação, despedida e índice, com teste e documentação");
    assert.match(out.out, /A correção e as decisões do climber espera a assinatura humana/, "six files, three of them code: still talc");
    await mohs(root, "sign", "summit-A");
    assert.equal((await running).state, "done");
  });
});
