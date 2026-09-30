import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { Basecamp } from "../src/basecamp/basecamp.ts";
import { FileDesk } from "../src/basecamp/desk.ts";
import { readEvents } from "../src/basecamp/event-log.ts";
import { TRACE_FILE } from "../src/basecamp/trace.ts";
import type { Hardness } from "../src/domain/types.ts";
import { ApiBoard } from "../src/drivers/api/api-board.ts";
import { FakeProvider, toolCall, type ScriptedTurn } from "../src/drivers/api/llm/fake.ts";
import { ProviderRegistry } from "../src/drivers/api/llm/registry.ts";
import type { CompletionRequest } from "../src/drivers/api/llm/types.ts";
import { LocalRunner } from "../src/runner/local-runner.ts";
import { TaskCrew } from "../src/tasks/task-crew.ts";
import { git, gitProject } from "./git-helpers.ts";
import { load, tempProject } from "./helpers.ts";

const ANCHOR = 'node -e "process.exit(0)"';

/** Answers as scout, setter or climber, depending on which finisher the request offers. */
function crewScript(hardness: Hardness = "fluorite") {
  return (request: CompletionRequest): ScriptedTurn => {
    const tools = request.tools.map((t) => t.name);
    const turn = request.messages.filter((m) => m.role === "assistant").length;
    if (tools.includes("plan")) {
      if (turn === 0) return { content: [toolCall("list_files", { path: "src" })] };
      return {
        content: [
          toolCall("plan", {
            reason: "troca de texto em um arquivo",
            routes: [
              {
                id: "A",
                name: "Saudação curta",
                hardness,
                files: ["src/greet.ts"],
                tags: ["ui"],
                pitches: [{ title: "Trocar a saudação", files: ["src/greet.ts"] }],
              },
            ],
          }),
        ],
      };
    }
    if (tools.includes("line"))
      return { content: [toolCall("line", { text: '# Line\n\nQUANDO alguém chama greet() ENTÃO recebe "oi" em vez de "olá".' })] };
    const script = [
      [toolCall("read_file", { path: "src/greet.ts" })],
      [toolCall("read_file", { path: ".env" })],
      [toolCall("edit_file", { path: "src/greet.ts", old: '"olá"', new: '"oi"' })],
      [toolCall("write_file", { path: "src/notes.md", content: "anotação fora do plano\n" })],
      [toolCall("safe", { summary: "greet() agora devolve oi" })],
    ];
    return { content: script[Math.min(turn, script.length - 1)] };
  };
}

function apiClimb(root: string, provider: FakeProvider, request = "Trocar a saudação para oi") {
  const config = load(root);
  const providers = new ProviderRegistry(config.settings, { overrides: { anthropic: provider } });
  const climbId = "20260929-1300-live";
  return new Basecamp({
    config,
    climbId,
    crew: new TaskCrew({ config, board: new ApiBoard({ config, providers }) }),
    runner: new LocalRunner({ config, climbId, worktreesDir: tempProject() }),
    desk: new FileDesk({ autoSign: true, autoRescue: "abandon" }),
    request,
  });
}

function project() {
  return gitProject({
    "src/greet.ts": 'export const greet = () => "olá";\n',
    ".env": "SECRET=abc\n",
    ".gitignore": ".env\n.mohs/\n",
    ".mohs/mohs.yaml": `commands:\n  anchor: [${JSON.stringify(ANCHOR)}]\n`,
  });
}

describe("api driver (our loop over a scripted model)", () => {
  it("takes a fluorite request from survey to a branch with the change, leaving the project untouched", async () => {
    const root = project();
    const provider = new FakeProvider(crewScript());
    const climb = apiClimb(root, provider);
    const view = await climb.run();
    const events = readEvents(climb.logFile);

    assert.equal(view.state, "done", JSON.stringify(view.errors));
    assert.equal(view.kind, "variation");
    assert.equal(view.routes[0].state, "summited");
    assert.equal(view.routes[0].branch, "mohs/20260929-1300-live/A");
    assert.equal(git(root, "show", "mohs/20260929-1300-live/A:src/greet.ts"), 'export const greet = () => "oi";');
    assert.equal(readFileSync(join(root, "src/greet.ts"), "utf8"), 'export const greet = () => "olá";\n');

    const friction = (kind: string) => events.flatMap((e) => (e.type === "friction" && e.data.kind === kind ? [e.data.detail] : []));
    assert.deepEqual(friction("brake.denied"), ["read_file: .env não é acessível para agentes"]);
    assert.deepEqual(friction("scope.drift"), ["alterou fora dos arquivos do pitch: src/notes.md"], "read from the commit, not the tools");
    const anchor = events.find((e) => e.type === "pitch.anchor");
    assert.deepEqual(anchor?.type === "pitch.anchor" && anchor.data.checks, [ANCHOR]);

    const trace = readFileSync(join(root, ".mohs", "climbs", climb.id, TRACE_FILE), "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    assert.deepEqual(
      trace.filter((t) => t.role === "climber").map((t) => `${t.tool}:${t.outcome}`),
      ["read_file:ok", "read_file:denied", "edit_file:ok", "write_file:ok"],
    );
  });

  it("keeps the stable pack in the system prompt and the task in the first message", async () => {
    const provider = new FakeProvider(crewScript());
    await apiClimb(project(), provider).run();
    const climberCall = provider.requests.find((r) => r.tools.some((t) => t.name === "safe"))!;
    assert.match(climberCall.system, /## Papel: climber/);
    assert.match(climberCall.system, /## Line/);
    assert.doesNotMatch(climberCall.system, /Pitch 1 de 1/);
    const firstMessage = climberCall.messages[0];
    assert.match(JSON.stringify(firstMessage), /Pitch 1 de 1 da route A/);
    assert.match(JSON.stringify(firstMessage), /chame `safe` ou `watch` ou `rock`/);
  });

  it("stops before the line when a quartz route has no way to run a sealed test", async () => {
    // Um projeto Go sem commands.seal: não há runner embutido para ele, ao contrário de Node e Python.
    const root = gitProject({
      "go.mod": "module tarefas\n",
      "greet.go": "package main\n",
      ".gitignore": ".mohs/\n",
      ".mohs/mohs.yaml": `commands:\n  anchor: [${JSON.stringify(ANCHOR)}]\n`,
    });
    const provider = new FakeProvider(crewScript("quartz"));
    const climb = apiClimb(root, provider);
    const view = await climb.run();
    assert.equal(view.state, "aborted");
    const aborted = readEvents(climb.logFile).find((e) => e.type === "climb.aborted");
    assert.match(aborted?.type === "climb.aborted" ? aborted.data.reason : "", /commands\.seal/);
    assert.ok(!provider.requests.some((r) => r.tools.some((t) => t.name === "line")), "no setter ran");
  });
});
