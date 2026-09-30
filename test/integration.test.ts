import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { readEvents } from "../src/basecamp/event-log.ts";
import { parseAnswer } from "../src/tasks/answers.ts";
import { agentClimb, mohs, useMohsBin, workDir } from "./agent-helpers.ts";
import { git, gitProject } from "./git-helpers.ts";
import { tempProject } from "./helpers.ts";

const ANCHOR = 'node -e "process.exit(0)"';

function project(): string {
  return gitProject({
    "package.json": '{ "type": "module" }\n',
    "src/greet.js": 'export const greet = () => "olá";\n',
    "README.md": "# tarefas\n",
    ".gitignore": ".mohs/\n",
    ".mohs/mohs.yaml": `commands:\n  anchor: [${JSON.stringify(ANCHOR)}]\n`,
  });
}

const route = (id: string, file: string, extra: object = {}) => ({
  id,
  name: `Route ${id}`,
  hardness: "fluorite",
  files: [file],
  tags: [],
  pitches: [{ title: `Pitch de ${id}`, files: [file] }],
  ...extra,
});

async function startClimb(root: string, t: Parameters<typeof agentClimb>[1], id: string, routes: object[]) {
  const running = agentClimb(root, t, id).run();
  const answer = join(tempProject(), "plan.json");
  writeFileSync(answer, JSON.stringify({ reason: "duas partes", routes }));
  await mohs(root, "next");
  await mohs(root, "call", "plan", "--file", answer);
  await mohs(root, "next");
  await mohs(root, "call", "line", "# Line\n\nQUANDO alguém chama greet() ENTÃO recebe o nome.\n");
  await mohs(root, "sign");
  // Num objeto: devolver a promise direto faria o await esperar o climb inteiro, que espera o agente.
  return { running };
}

describe("plan dependencies", () => {
  it("refuses an after that names no route, or that makes a cycle", () => {
    const plan = (routes: object[]) => parseAnswer(["plan"], { call: "plan", input: { reason: "x y z", routes } });
    const unknown = plan([route("A", "a.js", { after: ["Z"] })]);
    assert.match(unknown.ok ? "" : unknown.error, /routes\.0\.after: after cita Z/);
    const cycle = plan([route("A", "a.js", { after: ["B"] }), route("B", "b.js", { after: ["A"] })]);
    assert.match(cycle.ok ? "" : cycle.error, /formam um ciclo/);
  });
});

describe("integration: one delivery, tested together", () => {
  useMohsBin();

  it("starts a dependent route from the result of the one before, and delivers one branch", async (t) => {
    const root = project();
    const id = "20260930-0100-deps";
    const { running } = await startClimb(root, t, id, [route("A", "src/name.js"), route("B", "src/greet.js", { after: ["A"] })]);

    const first = await mohs(root, "next", "--role", "climber", "--as", "climber-A");
    assert.match(first.out, /tarefa T3 · climber · route A/);
    writeFileSync(join(workDir(first.out), "src/name.js"), 'export const name = "oi";\n');
    await mohs(root, "call", "safe", "name.js criado", "--as", "climber-A");

    const second = await mohs(root, "next", "--role", "climber", "--as", "climber-B");
    assert.match(second.out, /tarefa T4 · climber · route B/);
    const workspace = workDir(second.out);
    assert.equal(readFileSync(join(workspace, "src/name.js"), "utf8"), 'export const name = "oi";\n', "B starts from A's result");
    writeFileSync(join(workspace, "src/greet.js"), 'import { name } from "./name.js";\nexport const greet = () => name;\n');
    const done = await mohs(root, "call", "safe", "greet usa name", "--as", "climber-B");
    assert.match(done.out, /Climb concluído/);
    assert.match(done.out, new RegExp(`git merge mohs/${id}/entrega`));

    const view = await running;
    assert.equal(view.state, "done", JSON.stringify(view.errors));
    assert.deepEqual(view.delivery?.merged, ["A", "B"]);
    assert.equal(view.delivery?.clean, true);
    assert.deepEqual(view.windows, [["A"], ["B"]]);
    const waiting = readEvents(join(root, ".mohs", "climbs", id, "events.jsonl")).find((event) => event.type === "route.waiting");
    assert.equal(waiting?.route, "B", "B waits for A to join the delivery");
    assert.equal(
      git(root, "show", `mohs/${id}/entrega:src/greet.js`),
      'import { name } from "./name.js";\nexport const greet = () => name;',
    );
    assert.equal(git(root, "show", `mohs/${id}/entrega:src/name.js`), 'export const name = "oi";');
  });

  it("sends a merge conflict to a climber in the delivery worktree", async (t) => {
    const root = project();
    const id = "20260930-0100-cnfl";
    const { running } = await startClimb(root, t, id, [route("A", "src/a.js"), route("B", "src/b.js")]);

    // As duas routes, em paralelo, mexem no README sem declarar: o merge da segunda conflita.
    for (const [name, text] of [
      ["A", "# tarefas A\n"],
      ["B", "# tarefas B\n"],
    ] as const) {
      const task = await mohs(root, "next", "--role", "climber", "--route", name, "--as", `climber-${name}`);
      writeFileSync(join(workDir(task.out), `src/${name.toLowerCase()}.js`), "export {};\n");
      writeFileSync(join(workDir(task.out), "README.md"), text);
      await mohs(root, "call", "safe", `route ${name}`, "--as", `climber-${name}`);
    }

    const fix = await mohs(root, "next", "--as", "climber-entrega");
    assert.match(fix.out, /Correção da integração · Entrega do climb \(A \+ B\)/);
    assert.match(fix.out, /conflito em: README\.md/);
    const delivery = workDir(fix.out);
    assert.match(readFileSync(join(delivery, "README.md"), "utf8"), /<<<<<<<.*\n# tarefas A/s);
    writeFileSync(join(delivery, "README.md"), "# tarefas A e B\n");
    const done = await mohs(root, "call", "safe", "juntei os dois READMEs", "--as", "climber-entrega");
    assert.match(done.out, /Climb concluído/);

    const view = await running;
    assert.equal(view.state, "done", JSON.stringify(view.errors));
    assert.equal(view.delivery?.conflicts, 1);
    assert.equal(git(root, "show", `mohs/${id}/entrega:README.md`), "# tarefas A e B");
    assert.ok(readEvents(join(root, ".mohs/climbs", id, "events.jsonl")).some((e) => e.type === "integration.fixed"));
  });
});

describe("task ownership and lean context", () => {
  useMohsBin();

  it("keeps a task with the agent that took it and shows repeated sections once", async (t) => {
    const root = project();
    const id = "20260930-0100-owns";
    const { running } = await startClimb(root, t, id, [route("A", "src/greet.js")]);

    const mine = await mohs(root, "next", "--as", "ana");
    assert.match(mine.out, /tarefa T3 · climber · route A · pitch 1 · com ana/);
    assert.match(mine.out, /mohs call safe --task T3 --as ana/);
    assert.match(mine.out, /## Line\n\n# Line/);

    const other = await mohs(root, "next", "--as", "bia");
    assert.match(other.out, /Nada para bia agora: T3 está com ana desde \d\d:\d\d/);
    const stolen = await mohs(root, "call", "safe", "tentei", "--as", "bia");
    assert.equal(stolen.code, 1);
    assert.match(stolen.out, /a tarefa T3 está com ana/);

    const again = await mohs(root, "next", "--as", "ana");
    assert.match(again.out, /## Line\n\n\(igual à que você já recebeu · [0-9a-f]{10}/);
    assert.match((await mohs(root, "next", "--as", "ana", "--full")).out, /## Line\n\n# Line/);

    writeFileSync(join(workDir(mine.out), "src/greet.js"), 'export const greet = () => "oi";\n');
    assert.match((await mohs(root, "call", "safe", "pronto", "--as", "ana")).out, /Climb concluído/);
    assert.equal((await running).state, "done");
    assert.ok(!existsSync(join(root, ".mohs/climbs", id, "tasks/T3.answer.json")));
  });
});
