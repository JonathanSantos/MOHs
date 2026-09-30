import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { readEvents } from "../src/basecamp/event-log.ts";
import { agentClimb, mohs, useMohsBin, workDir } from "./agent-helpers.ts";
import { git, gitProject } from "./git-helpers.ts";
import { tempProject } from "./helpers.ts";

/** Checks the behavior with plain node, so it runs the same on every OS and outside any test runner. */
const ANCHOR = `node -e "import('./src/greet.js').then((m) => process.exit(m.greet().length > 0 ? 0 : 1))"`;
const CLIMB_ID = "20260929-1400-agnt";

const PLAN = {
  reason: "troca de texto em um arquivo",
  routes: [
    {
      id: "A",
      name: "Saudação curta",
      hardness: "fluorite",
      files: ["src/greet.js"],
      tags: ["ui"],
      pitches: [{ title: "Trocar a saudação", files: ["src/greet.js"] }],
    },
  ],
};

const LINE = '# Line\n\nQUANDO alguém chama greet() ENTÃO recebe "oi" em vez de "olá".\n';

function project(): string {
  return gitProject({
    "package.json": '{ "type": "module" }\n',
    "src/greet.js": 'export const greet = () => "olá";\n',
    ".gitignore": ".mohs/\n",
    ".mohs/mohs.yaml": `commands:\n  anchor: [${JSON.stringify(ANCHOR)}]\n`,
  });
}

describe("agent driver: a coding agent climbs through mohs next and mohs call", () => {
  useMohsBin();

  it("takes a fluorite request from the first task to a branch, with the human signing in between", async (t) => {
    const root = project();
    const climb = agentClimb(root, t, CLIMB_ID);
    const running = climb.run();

    const scout = await mohs(root, "next");
    assert.equal(scout.code, 0, scout.out);
    assert.match(scout.out, /MOHs · tarefa T1 · scout/);
    assert.match(scout.out, /Tarefa só de leitura/);
    assert.match(scout.out, /## Papel: scout/);
    assert.match(
      scout.out,
      /Limites da resposta plan .*routes\[\]\.pitches\[\]\.title: até 120 caracteres/,
      "limits show before any refusal",
    );
    assert.ok(scout.out.indexOf("Limites da resposta") < scout.out.indexOf("## Papel: scout"), "limits come before the work");
    assert.match(scout.out, /mohs call plan --task T1 --cwd \S+ <<'EOF'/, "the agent runs from another folder, so commands carry --cwd");

    const wrongAnswer = await mohs(root, "call", "safe", "pronto");
    assert.equal(wrongAnswer.code, 1);
    assert.match(wrongAnswer.out, /termina com: plan/);

    const badPlan = join(tempProject(), "plano.json");
    writeFileSync(badPlan, JSON.stringify({ ...PLAN, routes: [{ ...PLAN.routes[0], id: "rota-a" }] }));
    const refused = await mohs(root, "call", "plan", "--file", badPlan);
    assert.equal(refused.code, 1);
    assert.match(refused.out, /routes\.0\.id: use uma letra maiúscula/);

    const twoPitches = { title: "Outro passo", files: ["src/greet.js"] };
    writeFileSync(badPlan, JSON.stringify({ ...PLAN, routes: [{ ...PLAN.routes[0], pitches: [...PLAN.routes[0].pitches, twoPitches] }] }));
    assert.match((await mohs(root, "call", "plan", "--file", badPlan)).out, /routes\.0\.pitches: fluorite tem um único pitch/);

    writeFileSync(badPlan, JSON.stringify(PLAN));
    const planned = await mohs(root, "call", "plan", "--file", badPlan);
    assert.equal(planned.code, 0, planned.out);
    assert.match(planned.out, /✓ T1 · plan · A Saudação curta \(fluorite, 1 pitch\)/);
    assert.match(planned.out, /Próxima tarefa: T2, de setter .* outro papel/, "another role's task is only named");
    assert.match(planned.out, /mohs next --role setter/);
    const setter = await mohs(root, "next");
    assert.match(setter.out, /tarefa T2 · setter/);
    assert.match(setter.out, /Hardness fluorite: line curta/, "the setter writes for the hardness the scout chose");
    assert.doesNotMatch(setter.out, /bolts para toda interface/);

    const human = await mohs(root, "call", "line", LINE);
    assert.match(human.out, /Agora é a vez do humano/);
    assert.match(human.out, /mohs sign/);
    assert.match((await mohs(root, "next", "--json")).out, /"kind": "signature"/);
    const saved = await mohs(root, "line");
    assert.match(saved.out, /aguardando assinatura/);
    assert.ok(saved.out.includes(LINE.trim()), "the agent can check what was saved without reading .mohs/");

    await mohs(root, "sign");
    const climber = await mohs(root, "next");
    assert.match(climber.out, /tarefa T3 · climber · route A · pitch 1/);
    assert.ok(climber.out.includes(`Depois da resposta, o Basecamp roda: ${ANCHOR}`), climber.out);
    const workspace = /Onde trabalhar: (.+?) \(branch/.exec(climber.out)?.[1];
    assert.ok(workspace, climber.out);

    writeFileSync(join(workspace, "src/greet.js"), 'export const greet = () => "oi";\n');
    const tooLong = await mohs(root, "call", "safe", "x".repeat(300));
    assert.match(tooLong.out, /summary: .*280/);

    const answer = { summary: "greet() agora devolve oi", notes: "greet não tem teste próprio" };
    const summit = await mohs(root, "call", "safe", JSON.stringify(answer));
    assert.equal(summit.code, 0, summit.out);
    assert.match(summit.out, /✓ T3 · safe · resumo com 24\/280 caracteres e uma nota/);
    assert.match(summit.out, /nota +guardada para o descent/);
    assert.match(
      summit.out,
      /anchor +A1 · .* passou · commit [0-9a-f]{7} \(src\/greet\.js\)/,
      "the agent learns what ran and what was committed",
    );
    assert.match(summit.out, /Climb concluído/);
    assert.match(summit.out, new RegExp(`git merge mohs/${CLIMB_ID}/A`));

    const view = await running;
    assert.equal(view.state, "done", JSON.stringify(view.errors));
    assert.equal(git(root, "show", `mohs/${CLIMB_ID}/A:src/greet.js`), 'export const greet = () => "oi";');
    assert.equal(readFileSync(join(root, "src/greet.js"), "utf8"), 'export const greet = () => "olá";\n');
    const anchor = readEvents(climb.logFile).find((event) => event.type === "pitch.anchor");
    assert.deepEqual(anchor?.type === "pitch.anchor" && anchor.data.checks, [ANCHOR], "the Basecamp ran the checks itself");
    assert.ok(
      view.friction.some((f) => f.kind === "crew.note" && f.detail === answer.notes),
      "notes become friction for the descent",
    );
  });

  it("skips the setter when the scout writes the line of a fluorite climb", async (t) => {
    const root = project();
    const climb = agentClimb(root, t, "20260929-1405-lnsc");
    const running = climb.run();
    await mohs(root, "next");
    const planned = await mohs(root, "call", "plan", JSON.stringify({ ...PLAN, line: LINE }));
    assert.match(planned.out, /✓ T1 · plan · A Saudação curta \(fluorite, 1 pitch\) · com a line/);
    assert.match(planned.out, /Agora é a vez do humano/, "straight to the signature, no setter task");
    assert.ok((await mohs(root, "line")).out.includes(LINE.trim()));
    await mohs(root, "sign");
    const climber = await mohs(root, "next");
    assert.match(climber.out, /tarefa T2 · climber · route A/);
    writeFileSync(join(workDir(climber.out), "src/greet.js"), 'export const greet = () => "oi";\n');
    assert.match((await mohs(root, "call", "safe", "greet() agora devolve oi")).out, /Climb concluído/);
    const view = await running;
    assert.equal(view.state, "done", JSON.stringify(view.errors));
    const drafted = readEvents(climb.logFile).find((event) => event.type === "line.drafted");
    assert.equal(drafted?.actor, "scout");
  });

  it("sends a failed anchor back to the agent as a new attempt with the output", async (t) => {
    const root = project();
    const running = agentClimb(root, t, CLIMB_ID).run();
    const plan = join(tempProject(), "plano.json");
    writeFileSync(plan, JSON.stringify(PLAN));
    await mohs(root, "next");
    await mohs(root, "call", "plan", "--file", plan);
    await mohs(root, "next");
    await mohs(root, "call", "line", LINE);
    await mohs(root, "sign");
    const climber = await mohs(root, "next");
    const workspace = /Onde trabalhar: (.+?) \(branch/.exec(climber.out)![1];

    writeFileSync(join(workspace, "src/greet.js"), 'export const greet = () => "";\n');
    const retry = await mohs(root, "call", "safe", "troquei");
    assert.match(retry.out, /anchor +falhou; a saída está na nova tentativa abaixo/);
    assert.match(retry.out, /tarefa T4 · climber · route A · pitch 1 · tentativa 2/);
    assert.match(retry.out, /## Da tentativa anterior/);
    assert.ok(retry.out.includes(`${ANCHOR} falhou`), retry.out);

    writeFileSync(join(workspace, "src/greet.js"), 'export const greet = () => "oi";\n');
    assert.match((await mohs(root, "call", "safe", "agora sim")).out, /Climb concluído/);
    assert.equal((await running).state, "done");
  });

  it("starts a background Basecamp with --detach and hands the agent its first task", async (t) => {
    const root = project();
    const home = tempProject();
    const previousHome = process.env.MOHS_HOME;
    process.env.MOHS_HOME = home;
    t.after(() => {
      if (previousHome === undefined) delete process.env.MOHS_HOME;
      else process.env.MOHS_HOME = previousHome;
    });

    const started = await mohs(root, "climb", "Trocar a saudação para oi", "--detach", "--wait", "20");
    assert.equal(started.code, 0, started.out);
    assert.match(started.out, /em segundo plano/);
    assert.match(started.out, /tarefa T1 · scout/);

    const dir = /climb (\S+) em segundo plano/.exec(started.out)![1];
    const { pid } = JSON.parse(readFileSync(join(root, ".mohs", "climbs", dir, "basecamp.json"), "utf8")) as { pid: number };
    assert.notEqual(pid, process.pid, "the Basecamp runs in its own process");
    process.kill(pid);
    await new Promise((done) => setTimeout(done, 300));
    const orphan = await mohs(root, "next");
    assert.equal(orphan.code, 1);
    assert.match(orphan.out, /não está rodando/, "no one would pick up an answer, so the open task is not offered");
  });

  it("resumes a climb whose Basecamp died, from what the log says is done", async (t) => {
    const root = project();
    const home = tempProject();
    const previousHome = process.env.MOHS_HOME;
    process.env.MOHS_HOME = home;
    t.after(() => {
      if (previousHome === undefined) delete process.env.MOHS_HOME;
      else process.env.MOHS_HOME = previousHome;
    });
    const quartz = {
      reason: "saudação é contrato público",
      routes: [
        {
          ...PLAN.routes[0],
          hardness: "quartz",
          pitches: [
            { title: "Trocar a saudação", files: ["src/greet.js"] },
            { title: "Documentar a saudação", files: ["src/greet.js"] },
          ],
        },
      ],
    };
    const started = await mohs(root, "climb", "Trocar a saudação para oi", "--detach", "--wait", "20");
    const id = /climb (\S+) em segundo plano/.exec(started.out)![1];
    await mohs(root, "call", "plan", JSON.stringify(quartz));
    await mohs(root, "call", "line", LINE);
    await mohs(root, "sign");
    await mohs(root, "call", "bolts", "# Bolts · route A\n\ngreet(): string");
    const belayer = await mohs(root, "next", "--role", "belayer");
    const sealed = 'import { greet } from "../../src/greet.js";\nif (greet() !== "oi") process.exit(1);\n';
    mkdirSync(join(workDir(belayer.out), "test/sealed"), { recursive: true });
    writeFileSync(join(workDir(belayer.out), "test/sealed/oi.js"), sealed);
    await mohs(root, "call", "seal", JSON.stringify({ files: [{ path: "test/sealed/oi.js", kind: "unit" }] }));
    const pitch1 = await mohs(root, "next", "--role", "climber", "--as", "climber-A");
    writeFileSync(join(workDir(pitch1.out), "src/greet.js"), 'export const greet = () => "oi";\n');
    const pitch2 = await mohs(root, "call", "safe", "greet() devolve oi", "--as", "climber-A");
    const taskId = /tarefa (T\d+) · climber · route A · pitch 2/.exec(pitch2.out)?.[1];
    assert.ok(taskId, pitch2.out);

    const dir = join(root, ".mohs", "climbs", id);
    const { pid } = JSON.parse(readFileSync(join(dir, "basecamp.json"), "utf8")) as { pid: number };
    process.kill(pid);
    await new Promise((done) => setTimeout(done, 300));
    const stopped = await mohs(root, "next");
    assert.match(stopped.out, new RegExp(`mohs climb --resume ${id} --detach`), "the CLI says how to pick the climb up");

    const resumed = await mohs(root, "climb", "--resume", id, "--detach", "--wait", "20");
    assert.equal(resumed.code, 0, resumed.out);
    const again = await mohs(root, "next", "--as", "climber-A");
    assert.match(again.out, new RegExp(`tarefa ${taskId} · climber · route A · pitch 2`), "the agent keeps the task it had");
    writeFileSync(join(workDir(again.out), "src/greet.js"), '/** A saudação do app. */\nexport const greet = () => "oi";\n');
    const sent = await mohs(root, "call", "safe", "saudação documentada", "--as", "climber-A");
    assert.match(sent.out, /sent +route A · 1 testes selados passaram/, "the kept seal was restored, not written again");
    await mohs(root, "call", "report", JSON.stringify({ findings: [] }));
    const end = await mohs(root, "call", "beta", JSON.stringify({ proposals: [] }));
    assert.match(end.out, /Climb concluído/);

    const events = readEvents(join(dir, "events.jsonl"));
    const count = (type: string) => events.filter((event) => event.type === type).length;
    assert.equal(count("climb.resumed"), 1);
    assert.equal(count("seal.written"), 1, "the belayer did not seal again");
    assert.equal(count("bolts.set"), 1);
    assert.equal(git(root, "show", `mohs/${id}/A:src/greet.js`), '/** A saudação do app. */\nexport const greet = () => "oi";');
  });

  it("draws the croqui once, signed by a human, and later climbs carry it", async (t) => {
    const root = project();
    const home = tempProject();
    const previousHome = process.env.MOHS_HOME;
    process.env.MOHS_HOME = home;
    t.after(() => {
      if (previousHome === undefined) delete process.env.MOHS_HOME;
      else process.env.MOHS_HOME = previousHome;
    });
    const started = await mohs(root, "croqui", "--detach", "--wait", "20");
    assert.match(started.out, /tarefa T1 · scout/);
    assert.match(started.out, /Desenhar o croqui do projeto/);
    const croqui = {
      purpose: "Saudação de exemplo para testar o MOHs: uma função que devolve o texto de boas-vindas.",
      entities: [{ name: "Saudação", where: "src/greet.js", what: "o texto que o app mostra ao abrir" }],
      sensitive: [],
      pitfalls: [{ text: "o texto é exportado como constante e usado em testes de outros projetos", file: "src/nada.js" }],
      sections: [],
    };
    const wrong = await mohs(root, "call", "croqui", JSON.stringify(croqui));
    assert.match(wrong.out, /src\/nada\.js não existe no projeto/, "an uncited claim goes back to the scout");
    const signing = await mohs(
      root,
      "call",
      "croqui",
      JSON.stringify({ ...croqui, pitfalls: [{ ...croqui.pitfalls[0], file: "src/greet.js" }] }),
    );
    assert.match(signing.out, /O croqui do projeto espera a assinatura humana/);
    const signed = await mohs(root, "sign", "croqui");
    assert.equal(signed.code, 0, signed.out);
    const done = await mohs(root, "next", "--wait", "20");
    assert.match(done.out, /Croqui assinado e salvo em \.mohs\/croqui\.md/);

    const saved = JSON.parse(readFileSync(join(root, ".mohs", "croqui.json"), "utf8")) as {
      signedBy: string;
      cited: Record<string, string>;
    };
    assert.ok(saved.signedBy && saved.cited["src/greet.js"], "the signature and the cited files' hashes are kept");
    assert.match((await mohs(root, "croqui", "--show")).out, /Saudação \(src\/greet\.js\)/);
    writeFileSync(join(root, "src/greet.js"), 'export const greet = () => "olá!";\n');
    assert.match((await mohs(root, "croqui", "--show")).out, /pode estar desatualizado: src\/greet\.js mudou/);

    const running = agentClimb(root, t, "20260930-0300-crqi").run();
    const scout = await mohs(root, "next");
    assert.match(scout.out, /## Croqui do projeto\n\nSaudação de exemplo/, "the next climb's scout reads the croqui");
    void running;
  });
});
