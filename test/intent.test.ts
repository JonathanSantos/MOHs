import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { readEvents } from "../src/basecamp/event-log.ts";
import { agentClimb, mohs, useMohsBin, workDir } from "./agent-helpers.ts";
import { git, gitProject } from "./git-helpers.ts";
import { tempProject } from "./helpers.ts";

const GREET_TEST =
  'import test from "node:test";\nimport assert from "node:assert";\nimport { greet } from "../src/greet.js";\ntest("greet", () => assert.ok(greet()));\n';
const REPRO =
  'import test from "node:test";\nimport assert from "node:assert";\nimport { greet } from "../src/greet.js";\ntest("a saudação é oi", () => assert.equal(greet(), "oi"));\n';

function project(): string {
  return gitProject({
    "package.json": '{ "type": "module" }\n',
    "src/greet.js": 'export const greet = () => "olá";\n',
    "test/greet.test.js": GREET_TEST,
    ".gitignore": ".mohs/\n",
    ".mohs/mohs.yaml": 'commands:\n  anchor: ["node --test"]\n  seal: "node --test {file}"\n',
  });
}

function write(dir: string, path: string, content: string): void {
  mkdirSync(dirname(join(dir, path)), { recursive: true });
  writeFileSync(join(dir, path), content);
}

const plan = (intent: string) => ({
  reason: "troca pequena, sem área sensível",
  intent,
  line: '# Line\n\nQUANDO alguém chama greet() ENTÃO recebe "oi".\n',
  routes: [
    {
      id: "A",
      name: "Saudação",
      hardness: "fluorite",
      files: ["src/greet.js"],
      tags: [],
      pitches: [{ title: "Trocar a saudação", files: ["src/greet.js"] }],
    },
  ],
});

describe("ceremony by intent", () => {
  useMohsBin();

  it("fix: a reproducer proves the bug first; the climber sees the test, the send runs it, the project keeps it", async (t) => {
    const root = project();
    const id = "20260930-1000-fixx";
    const climb = agentClimb(root, t, id, "A saudação devia ser oi e sai olá");
    const running = climb.run();
    const answerFile = join(tempProject(), "answer.json");
    const json = (value: unknown) => {
      writeFileSync(answerFile, JSON.stringify(value));
      return ["--file", answerFile];
    };
    await mohs(root, "next");
    const planned = await mohs(root, "call", "plan", ...json(plan("fix")));
    assert.match(planned.out, /T2, de reproducer/, "a fix starts by reproducing the bug");
    const reproducer = await mohs(root, "next");
    assert.match(reproducer.out, /tarefa T2 · reproducer/);
    assert.match(reproducer.out, /Não corrija o bug: só o reproduza/);
    const bench = workDir(reproducer.out);
    write(bench, "test/repro-oi.test.js", 'import test from "node:test";\ntest("passa", () => {});\n');
    const green = await mohs(root, "call", "repro", ...json({ files: [{ path: "test/repro-oi.test.js" }], shows: "greet() devolve olá" }));
    assert.match(green.out, /repro\.green/, "a test that passes today reproduces nothing");
    write(workDir(green.out), "test/repro-oi.test.js", REPRO);
    await mohs(root, "call", "repro", ...json({ files: [{ path: "test/repro-oi.test.js" }], shows: "greet() devolve olá" }));

    await mohs(root, "sign");
    const climber = await mohs(root, "next");
    assert.match(climber.out, /## Teste que reproduz o bug[\s\S]*assert\.equal\(greet\(\), "oi"\)/, "the climber sees the reproduction");
    write(workDir(climber.out), "src/greet.js", 'export const greet = () => "oi";\n');
    const sent = await mohs(root, "call", "safe", "greet() devolve oi");
    assert.match(sent.out, /sent +route A/, "a fluorite route of a fix is sent, with the reproduction");

    const view = await running;
    assert.equal(view.state, "done", JSON.stringify(view.errors));
    assert.equal(view.intent, "fix");
    assert.match(
      git(root, "show", `mohs/${id}/A:test/repro-oi.test.js`),
      /"oi"/,
      "the reproduction joins the project as a regression test",
    );
    assert.match(view.routes[0].evidence?.proofs.join(" ") ?? "", /teste de reprodução \(falhava antes, passa agora\)/);
    assert.equal(view.routes[0].evidence?.grade, "forte");
  });

  it("refactor: the tests that already existed cannot change", async (t) => {
    const root = project();
    const running = agentClimb(root, t, "20260930-1001-rfct", "Extrair a saudação para uma constante").run();
    const answerFile = join(tempProject(), "answer.json");
    const json = (value: unknown) => {
      writeFileSync(answerFile, JSON.stringify(value));
      return ["--file", answerFile];
    };
    await mohs(root, "next");
    await mohs(
      root,
      "call",
      "plan",
      ...json({ ...plan("refactor"), line: "# Line\n\nQUANDO alguém chama greet() ENTÃO recebe o mesmo de hoje.\n" }),
    );
    await mohs(root, "sign");
    const climber = await mohs(root, "next");
    const work = workDir(climber.out);
    write(work, "src/greet.js", 'const GREETING = "olá";\nexport const greet = () => GREETING;\n');
    write(work, "test/greet.test.js", GREET_TEST.replace("assert.ok(greet())", 'assert.equal(greet(), "olá")'));
    const refused = await mohs(root, "call", "safe", "extraí a constante e reforcei o teste");
    assert.match(refused.out, /os testes que já existiam [\s\S]*Restaure: test\/greet\.test\.js/);
    write(workDir(refused.out), "test/greet.test.js", GREET_TEST);
    const done = await mohs(root, "call", "safe", "restaurei o teste");
    assert.match(done.out, /Climb concluído/);
    assert.equal((await running).state, "done");
  });

  it("talc: a reproduction the climber declares is checked against the base", async (t) => {
    const root = project();
    const id = "20260930-1002-talc";
    const running = agentClimb(root, t, id, "A saudação devia ser oi", "talc").run();
    const climber = await mohs(root, "next");
    const work = workDir(climber.out);
    write(work, "src/greet.js", 'export const greet = () => "oi";\n');
    write(work, "test/repro-oi.test.js", REPRO);
    const signing = await mohs(root, "call", "safe", JSON.stringify({ summary: "greet() devolve oi", repro: ["test/repro-oi.test.js"] }));
    assert.match(signing.out, /repro +route A · test\/repro-oi\.test\.js: falhava antes, passa agora/);
    await mohs(root, "sign", "summit-A");
    const view = await running;
    assert.equal(view.routes[0].evidence?.grade, "forte", "a proven reproduction plus the project's tests");
    const verified = readEvents(join(root, ".mohs", "climbs", id, "events.jsonl")).find((event) => event.type === "repro.verified");
    assert.ok(verified);
  });
});
