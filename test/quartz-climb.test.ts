import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { readEvents } from "../src/basecamp/event-log.ts";
import { listTasks } from "../src/tasks/file-board.ts";
import { agentClimb, mohs, useMohsBin, workDir } from "./agent-helpers.ts";
import { git, gitProject } from "./git-helpers.ts";
import { tempProject } from "./helpers.ts";

const CLIMB_ID = "20260929-2100-qrtz";
const ANCHOR = `node -e "import('./src/greet.js').then((m) => process.exit(m.greet().length > 0 ? 0 : 1))"`;
/** A sealed test is a plain script here: it fails unless greet() says "oi". */
const SEALED = `import { greet } from "../../src/greet.js";\nif (greet() !== "oi") {\n  console.log("saudação errada: " + greet());\n  process.exit(1);\n}\n`;

const PLAN = {
  reason: "feature pequena, mas a saudação é contrato público",
  routes: [
    {
      id: "A",
      name: "Saudação curta",
      hardness: "quartz",
      files: ["src/greet.js"],
      tags: ["api"],
      pitches: [{ title: "Trocar a saudação", files: ["src/greet.js"] }],
    },
  ],
};

function project(): string {
  return gitProject({
    "package.json": '{ "type": "module" }\n',
    "src/greet.js": 'export const greet = () => "olá";\n',
    ".gitignore": ".mohs/\n",
    ".mohs/mohs.yaml": `commands:\n  anchor: [${JSON.stringify(ANCHOR)}]\n  seal: "node {file}"\n`,
  });
}

function write(dir: string, path: string, content: string): void {
  mkdirSync(dirname(join(dir, path)), { recursive: true });
  writeFileSync(join(dir, path), content);
}

describe("quartz through the agent CLI", () => {
  useMohsBin();

  it("seals tests the climber never sees, turns a fall into a FALL, and inspects before the summit", async (t) => {
    const root = project();
    const climb = agentClimb(root, t, CLIMB_ID);
    const running = climb.run();
    const answerFile = join(tempProject(), "answer.json");
    const json = (value: unknown) => {
      writeFileSync(answerFile, JSON.stringify(value));
      return ["--file", answerFile];
    };

    await mohs(root, "next");
    await mohs(root, "call", "plan", ...json(PLAN));
    const setter = await mohs(root, "next");
    assert.match(setter.out, /Hardness quartz: line completa.*não os escreva na line/);
    await mohs(root, "call", "line", '# Line\n\nQUANDO alguém chama greet() ENTÃO recebe "oi".\n');
    await mohs(root, "sign");

    const bolts = await mohs(root, "next");
    assert.match(bolts.out, /tarefa T3 · setter · route A/);
    const handoff = await mohs(root, "call", "bolts", "# Bolts · route A\n\ngreet(): string");
    assert.match(handoff.out, /Próxima tarefa: T4, de belayer .* não aparece aqui/, "the setter only learns who is next");
    assert.match(handoff.out, /mohs next --role belayer/);
    const orchestrator = await mohs(root, "next");
    assert.match(orchestrator.out, /T4 · belayer · route A · .* → .*next --role belayer --route A --as belayer-A/);
    assert.doesNotMatch(orchestrator.out, /contexto isolado|## Bolts/, "whoever asks without the role never reads the belayer's task");
    const belayer = await mohs(root, "next", "--role", "belayer", "--as", "belayer-A");
    assert.match(belayer.out, /tarefa T4 · belayer · route A/);
    assert.match(belayer.out, /contexto isolado/);
    assert.match(belayer.out, /## Bolts/, "the belayer writes against the bolts");
    const climberWaits = await mohs(root, "next", "--role", "climber");
    assert.match(climberWaits.out, /Nenhuma tarefa aberta para climber/, "a role subagent stops at another role's task");
    assert.match(climberWaits.out, /Próxima tarefa: T4, de belayer[\s\S]*mohs next --role belayer/);
    assert.match(belayer.out, /Teto: até 3 casos de teste no total \(1 cenário\(s\) da route na line × 3 por cenário\)/);
    const bench = workDir(belayer.out);
    const fourCases = Array.from({ length: 4 }, (_, i) => `test("caso ${i}", () => { throw new Error("vermelho"); });`).join("\n");
    write(bench, "test/sealed/demais.test.js", `import test from "node:test";\n${fourCases}\n`);
    const tooMany = await mohs(root, "call", "seal", ...json({ files: [{ path: "test/sealed/demais.test.js", kind: "unit" }] }));
    assert.match(tooMany.out, /Você escreveu 4 casos de teste; o teto desta route é 3/, "one refusal, with the reason");
    const again = workDir(tooMany.out);
    write(again, "test/sealed/oi.js", SEALED);

    const sealed = await mohs(root, "call", "seal", ...json({ files: [{ path: "test/sealed/oi.js", kind: "unit" }] }));
    assert.match(sealed.out, /✓ T5 · seal · 1 arquivo de teste selado/);
    assert.match(sealed.out, /Próxima tarefa: T6, de climber/);
    const sameAgent = await mohs(root, "next", "--role", "climber", "--as", "belayer-A");
    assert.match(sameAgent.out, /belayer-A já fez tarefa de belayer neste climb/, "whoever wrote the sealed tests never implements");
    const climber = await mohs(root, "next", "--role", "climber");
    assert.match(climber.out, /tarefa T6 · climber · route A · pitch 1/);
    assert.doesNotMatch(climber.out, /sealed|saudação errada/, "the climber's task never mentions the seal");
    const workspace = workDir(climber.out);
    assert.ok(!existsSync(bench), "the belayer's checkout is gone");

    write(workspace, "src/greet.js", 'export const greet = () => "oii";\n');
    const fell = await mohs(root, "call", "safe", "greet() devolve oii");
    assert.match(fell.out, /fall +route A · 1 de 1 falharam/);
    assert.match(fell.out, /Próxima tarefa: T7, de belayer/);
    assert.doesNotMatch(fell.out, /saudação errada|!== "oi"/, "the climber never reads the belayer's task");
    const fallTask = await mohs(root, "next", "--role", "belayer");
    assert.match(fallTask.out, /tarefa T7 · belayer · route A/);
    assert.match(fallTask.out, /saudação errada: oii/, "the belayer reads the raw output");

    await mohs(root, "call", "fall", ...json({ scenario: "chamar greet()", expected: '"oi"', actual: '"oii"' }));
    const fix = await mohs(root, "next", "--role", "climber");
    assert.match(fix.out, /tarefa T8 · climber · route A/);
    assert.match(fix.out, /chamar greet\(\): esperado "oi", obtido "oii"/, "the climber gets the FALL");
    assert.doesNotMatch(fix.out, /saudação errada|!== "oi"/, "and never the sealed test or its raw output");

    write(workspace, "src/greet.js", 'export const greet = () => "oi";\n');
    const clean = await mohs(root, "call", "safe", "greet() devolve oi");
    assert.match(clean.out, /sent +route A · 1 testes selados passaram/);
    assert.match(clean.out, /Próxima tarefa: T9, de inspector/);
    const inspector = await mohs(root, "next", "--role", "inspector");
    assert.match(inspector.out, /tarefa T9 · inspector · route A/);
    assert.match(inspector.out, /Inspection architecture/);
    assert.match(
      inspector.out,
      /   1 \+ export const greet = \(\) => "oi"/,
      "the inspector reads the route's diff, numbered as in the file",
    );

    await mohs(root, "call", "report", ...json({ findings: [] }));
    const scribe = await mohs(root, "next", "--role", "scribe");
    assert.match(scribe.out, /tarefa T10 · scribe/);
    assert.match(scribe.out, /O que o climber fez:\n- route A: greet\(\) devolve oi/);
    assert.match(scribe.out, /Extensões que já existem\. Skills: /);
    const proposal = {
      kind: "beta",
      target: ".mohs/beta/saudacao.md",
      summary: "A saudação é contrato público.",
      evidence: ["send.fall · route A"],
    };
    const end = await mohs(root, "call", "beta", ...json({ proposals: [proposal] }));
    assert.match(end.out, /Climb concluído/);

    const view = await running;
    assert.equal(view.state, "done", JSON.stringify(view.errors));
    assert.equal(view.falls, 1);
    assert.deepEqual(
      view.proposals.map((p) => p.id),
      ["b-01"],
    );
    assert.equal(git(root, "show", `mohs/${CLIMB_ID}/A:src/greet.js`), 'export const greet = () => "oi";');
    assert.equal(
      git(root, "ls-tree", "-r", "--name-only", `mohs/${CLIMB_ID}/A`).includes("sealed"),
      false,
      "sealed tests never reach the branch",
    );

    const types = readEvents(climb.logFile).map((event) => event.type);
    for (const type of ["bolts.set", "seal.red", "send.fall", "fix.started", "send.clean", "inspection.report", "descent.beta"]) {
      assert.ok(types.includes(type as never), `missing ${type}`);
    }
    const report = await mohs(root, "report");
    assert.equal(report.code, 0, report.out);
    const html = readFileSync(join(root, ".mohs", "climbs", CLIMB_ID, "index.html"), "utf8");
    assert.match(html, /Seal da route A: 1 unit, 0 e2e/, "the report tells the seal happened");
    assert.doesNotMatch(html, /saudação errada|!== \\"oi\\"/, "and never what the sealed tests say");
    const climberTasks = listTasks(join(root, ".mohs", "climbs", CLIMB_ID)).filter((task) => task.role === "climber");
    assert.ok(climberTasks.length === 2 && climberTasks.every((task) => !`${task.brief}${task.assignment}`.includes("saudação errada")));
  });

  it("lets the climber contest a wrong sealed test with the line, and a human settles a second dispute", async (t) => {
    const root = project();
    const climb = agentClimb(root, t, CLIMB_ID);
    const running = climb.run();
    const answerFile = join(tempProject(), "answer.json");
    const json = (value: unknown) => {
      writeFileSync(answerFile, JSON.stringify(value));
      return ["--file", answerFile];
    };
    const LINE = 'QUANDO alguém chama greet() ENTÃO recebe "oi".';
    await mohs(root, "next");
    await mohs(root, "call", "plan", ...json(PLAN));
    await mohs(root, "next");
    await mohs(root, "call", "line", `# Line\n\n${LINE}\n`);
    await mohs(root, "sign");
    await mohs(root, "call", "bolts", "# Bolts · route A\n\ngreet(): string");
    const belayer = await mohs(root, "next", "--role", "belayer");
    // O belayer erra: a line pede "oi", o teste exige "oi!".
    write(workDir(belayer.out), "test/sealed/oi.js", SEALED.replaceAll('"oi"', '"oi!"').replaceAll("esperado oi", "esperado oi!"));
    await mohs(root, "call", "seal", ...json({ files: [{ path: "test/sealed/oi.js", kind: "unit" }] }));

    const climber = await mohs(root, "next", "--role", "climber");
    write(workDir(climber.out), "src/greet.js", 'export const greet = () => "oi";\n');
    await mohs(root, "call", "safe", "greet() devolve oi");
    await mohs(root, "next", "--role", "belayer");
    await mohs(root, "call", "fall", ...json({ scenario: "chamar greet()", expected: '"oi!"', actual: '"oi"' }));

    const fix = await mohs(root, "next", "--role", "climber");
    assert.match(fix.out, /• dispute:/, "after a FALL the climber may contest the test");
    const dispute = { excerpt: LINE, argument: 'a line pede "oi", sem exclamação' };
    await mohs(root, "call", "dispute", ...json(dispute));
    const judge = await mohs(root, "next", "--role", "belayer");
    assert.match(judge.out, /O climber contesta a FALL que recebeu/);
    assert.match(judge.out, /• uphold:/);
    await mohs(root, "call", "uphold", "a exclamação faz parte da saudação");

    const back = await mohs(root, "next", "--role", "climber");
    assert.match(back.out, /Sua contestação não mudou o teste: a exclamação faz parte da saudação/);
    await mohs(root, "call", "dispute", ...json(dispute));
    const human = await mohs(root, "next");
    assert.match(human.out, /contesta de novo o teste selado/, "a second dispute goes to a human");
    await mohs(root, "rescue", "proceed");

    const amend = await mohs(root, "next", "--role", "belayer");
    assert.match(amend.out, /deu razão ao climber/);
    assert.doesNotMatch(amend.out, /• uphold:/, "once a human sided with the climber, the belayer corrects the test");
    write(workDir(amend.out), "test/sealed/oi.js", SEALED);
    const amended = await mohs(
      root,
      "call",
      "seal",
      ...json({ files: [{ path: "test/sealed/oi.js", kind: "unit" }], reason: "a line pede oi" }),
    );
    assert.match(amended.out, /Próxima tarefa: .* de inspector/, "the corrected seal passes on the climber's code");
    await mohs(root, "call", "report", ...json({ findings: [] }));
    await mohs(root, "call", "beta", ...json({ proposals: [] }));

    const view = await running;
    assert.equal(view.state, "done", JSON.stringify(view.errors));
    const events = readEvents(climb.logFile);
    assert.equal(events.filter((event) => event.type === "seal.disputed").length, 2);
    assert.deepEqual(
      events.filter((event) => event.type === "seal.upheld").map((event) => event.actor),
      ["belayer A"],
    );
    assert.ok(events.some((event) => event.type === "seal.amended"));
    assert.equal(git(root, "show", `mohs/${CLIMB_ID}/A:src/greet.js`), 'export const greet = () => "oi";');
  });

  it("sends the belayer back when a sealed test already passes", async (t) => {
    const root = project();
    const running = agentClimb(root, t, CLIMB_ID).run();
    const answerFile = join(tempProject(), "answer.json");
    const json = (value: unknown) => {
      writeFileSync(answerFile, JSON.stringify(value));
      return ["--file", answerFile];
    };
    await mohs(root, "next");
    await mohs(root, "call", "plan", ...json(PLAN));
    await mohs(root, "next");
    await mohs(root, "call", "line", '# Line\n\nQUANDO alguém chama greet() ENTÃO recebe "oi".\n');
    await mohs(root, "sign");
    await mohs(root, "call", "bolts", "# Bolts · route A\n\ngreet(): string");
    const belayer = await mohs(root, "next", "--role", "belayer");

    write(workDir(belayer.out), "test/sealed/ola.js", SEALED.replaceAll('"oi"', '"olá"'));
    const again = await mohs(root, "call", "seal", ...json({ files: [{ path: "test/sealed/ola.js", kind: "unit" }] }));
    assert.match(again.out, /friction +route A · seal\.green/);
    assert.match(again.out, /tarefa T5 · belayer · route A · tentativa 2/);
    assert.match(again.out, /já passam no código atual/);

    const missing = await mohs(root, "call", "seal", ...json({ files: [{ path: "test/sealed/nada.js", kind: "unit" }] }));
    assert.match(missing.out, /tarefa T6 · belayer/);
    assert.match(missing.out, /não existe no diretório da tarefa/);
    void running;
  });

  it("waits for a human to sign the bolts and the summit of a diamond route", async (t) => {
    const root = project();
    const climb = agentClimb(root, t, CLIMB_ID);
    const running = climb.run();
    const answerFile = join(tempProject(), "answer.json");
    const json = (value: unknown) => {
      writeFileSync(answerFile, JSON.stringify(value));
      return ["--file", answerFile];
    };
    const diamond = { ...PLAN, routes: [{ ...PLAN.routes[0], hardness: "diamond" }] };
    await mohs(root, "next");
    await mohs(root, "call", "plan", ...json(diamond));
    await mohs(root, "next");
    await mohs(root, "call", "line", '# Line\n\nQUANDO alguém chama greet() ENTÃO recebe "oi".\n');
    await mohs(root, "sign");

    const bolts = await mohs(root, "call", "bolts", "# Bolts · route A\n\ngreet(): string");
    assert.match(bolts.out, /Os bolts da route A espera a assinatura humana/);
    assert.match(bolts.out, /mohs sign bolts-A/);
    assert.equal((await mohs(root, "sign", "summit-A")).code, 1, "only what is pending can be signed");
    assert.match((await mohs(root, "sign")).out, /bolts-A assinado/);

    const belayer = await mohs(root, "next", "--role", "belayer");
    write(workDir(belayer.out), "test/sealed/oi.js", SEALED);
    await mohs(root, "call", "seal", ...json({ files: [{ path: "test/sealed/oi.js", kind: "unit" }] }));
    const climber = await mohs(root, "next", "--role", "climber");
    write(workDir(climber.out), "src/greet.js", 'export const greet = () => "oi";\n');
    await mohs(root, "call", "safe", "greet() devolve oi");

    // Diamond: todos os inspectors do núcleo, cada um numa tarefa.
    const inspectors = await mohs(root, "next", "--role", "inspector");
    const ids = [...inspectors.out.matchAll(/\b(T\d+) \(Inspection/g)].map((m) => m[1]);
    const first = /tarefa (T\d+) · inspector/.exec(inspectors.out)![1];
    for (const id of [first, ...ids]) await mohs(root, "call", "report", "--task", id, ...json({ findings: [] }));

    const summit = await mohs(root, "next");
    assert.match(summit.out, /A entrega da route A espera a assinatura humana/);
    assert.match(summit.out, /mohs sign summit-A/);
    await mohs(root, "sign", "summit-A");
    await mohs(root, "next", "--role", "scribe");
    await mohs(root, "call", "beta", ...json({ proposals: [] }));

    const view = await running;
    assert.equal(view.state, "done", JSON.stringify(view.errors));
    assert.deepEqual(
      view.signatures.map((s) => `${s.target}:${s.signed}`),
      ["bolts-A:true", "summit-A:true"],
    );
    assert.equal(view.routes[0].inspectors.length, 3, "diamond runs every inspector");
  });
});
