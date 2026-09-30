import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, it } from "node:test";
import { CLI_ENTRY } from "../src/cli/invocation.ts";
import { readHookInput, type ToolUse } from "../src/hooks/input.ts";
import { judgeStop, judgeTool, type GuardState } from "../src/hooks/policy.ts";
import type { TaskRecord } from "../src/tasks/file-board.ts";
import type { Situation } from "../src/tasks/situation.ts";
import { agentClimb, useMohsBin } from "./agent-helpers.ts";
import { gitProject } from "./git-helpers.ts";
import { tempProject } from "./helpers.ts";

const ROOT = "/p";
const HOME = "/h/.mohs";
const WORKTREE = `${HOME}/worktrees/p-1/c/A`;

function task(overrides: Partial<TaskRecord>): TaskRecord {
  return {
    id: "T3",
    openedAt: "",
    status: "open",
    role: "climber",
    title: "Pitch 1",
    cwd: WORKTREE,
    access: "write",
    brief: "",
    assignment: "",
    answers: ["safe"],
    commands: [],
    checks: [],
    files: [],
    ...overrides,
  };
}

function state(situation: Situation | null): GuardState {
  return { projectRoot: ROOT, mohsDir: `${ROOT}/.mohs`, sealsDir: `${HOME}/seals`, worktreesDir: `${HOME}/worktrees`, situation };
}

const tool = (kind: ToolUse["kind"], paths: string[], command?: string): ToolUse => ({ name: kind, kind, paths, command });
const climbing: Situation = { kind: "task", task: task({}), others: [] };
const planning: Situation = { kind: "task", task: task({ id: "T1", role: "scout", access: "read", cwd: ROOT }), others: [] };

describe("hook policy", () => {
  it("keeps sealed tests off limits at all times", () => {
    assert.equal(judgeTool(tool("read", [`${HOME}/seals/p-1/c/A/t.js`]), state(null)).allow, false);
    assert.equal(judgeTool(tool("exec", [], `cat ${HOME}/seals/p-1/c/A/t.js`), state(null)).allow, false);
  });

  it("stays out of the way when no climb runs", () => {
    assert.equal(judgeTool(tool("write", [`${ROOT}/src/a.ts`]), state(null)).allow, true);
    assert.equal(judgeTool(tool("exec", [], "git commit -m x"), state({ kind: "done", view: {} as never })).allow, true);
  });

  it("protects .mohs, secrets and git while a climb runs", () => {
    assert.match(verdict(judgeTool(tool("read", [`${ROOT}/.mohs/climbs/c/line.md`]), state(climbing))), /mohs line/);
    assert.equal(judgeTool(tool("read", [`${ROOT}/.env.local`]), state(climbing)).allow, false);
    assert.match(verdict(judgeTool(tool("exec", [], "git -C /x commit -am pronto"), state(climbing))), /git commit é com o Basecamp/);
    assert.equal(judgeTool(tool("exec", [], "npm test && git status"), state(climbing)).allow, true);
  });

  it("lets writes land only in the directory of an open task that writes", () => {
    assert.equal(judgeTool(tool("write", [`${WORKTREE}/src/a.ts`]), state(climbing)).allow, true);
    assert.match(verdict(judgeTool(tool("write", [`${ROOT}/src/a.ts`]), state(climbing))), /só no diretório da tarefa/);
    assert.equal(judgeTool(tool("write", ["/tmp/resposta.json"]), state(climbing)).allow, true, "scratch files are fine");
    assert.match(verdict(judgeTool(tool("write", [`${ROOT}/src/a.ts`]), state(planning))), /nenhuma tarefa aberta permite escrever/);
    const signing: Situation = { kind: "signature", target: "line", what: "A line", review: "" };
    assert.equal(
      judgeTool(tool("write", [`${WORKTREE}/src/a.ts`]), state(signing)).allow,
      false,
      "no coding while the human reads the line",
    );
  });

  it("keeps the agent working while a task waits, and lets it go on human turns", () => {
    const stop = judgeStop(climbing);
    assert.equal(stop.allow, false);
    assert.match(stop.allow ? "" : stop.reason, /T3 \(climber\)/);
    assert.equal(judgeStop({ kind: "signature", target: "line", what: "A line", review: "" }).allow, true);
    assert.equal(judgeStop({ kind: "working", detail: "rodando a anchor" }).allow, false);
    assert.equal(judgeStop(null).allow, true);
  });
});

describe("hook input", () => {
  it("reads Claude Code and Copilot payloads into one shape", () => {
    const claude = readHookInput({ cwd: "/p", tool_name: "Edit", tool_input: { file_path: "src/a.ts" } }, "/x");
    // Os caminhos saem absolutos no formato da plataforma: no Windows, /p/src/a.ts vira D:\\p\\src\\a.ts.
    assert.deepEqual(claude.tool, { name: "Edit", kind: "write", paths: [resolve("/p/src/a.ts")], command: undefined });
    const copilot = readHookInput({ cwd: "/p", toolName: "view", toolArgs: '{"path":"/p/.env"}' }, "/x");
    assert.deepEqual(copilot.tool?.paths, [resolve("/p/.env")]);
    assert.equal(copilot.tool?.kind, "read");
    const escaping = readHookInput({ cwd: "/p", tool_name: "Read", tool_input: { file_path: "/p/src/../.env" } }, "/x");
    assert.deepEqual(escaping.tool?.paths, [resolve("/p/.env")]);
    const patch = readHookInput({ cwd: "/p", toolName: "apply_patch", toolArgs: { input: "*** Update File: src/b.ts\n@@" } }, "/x");
    assert.deepEqual(patch.tool?.paths, [resolve("/p/src/b.ts")]);
    assert.equal(readHookInput({ cwd: "/p", tool_name: "WebSearch", tool_input: {} }, "/x").tool?.kind, "other");
  });
});

describe("mohs hook, as the agent platforms call it", () => {
  useMohsBin();

  /** The real CLI in its own process, with the hook payload on stdin, as Claude Code and Copilot run it. */
  function hook(root: string, home: string, event: string, payload: object, platform = "claude"): unknown {
    const out = execFileSync(process.execPath, [CLI_ENTRY, "hook", event, "--for", platform], {
      cwd: root,
      input: JSON.stringify(payload),
      encoding: "utf8",
      env: { ...process.env, MOHS_HOME: home, CLAUDE_PROJECT_DIR: root, NODE_TEST_CONTEXT: "", MOHS_DEBUG: "1" },
      stdio: ["pipe", "pipe", "inherit"],
    }).trim();
    return out ? JSON.parse(out) : null;
  }

  it("answers each platform in its own format, and never blocks a stubborn agent forever", async (t) => {
    const root = gitProject({ "src/greet.js": "export const greet = () => 'olá';\n", ".gitignore": ".mohs/\n", ".mohs/mohs.yaml": "{}\n" });
    const home = tempProject();
    const running = agentClimb(root, t, "20260929-2200-hook").run();
    void running;
    // Espera a primeira tarefa (scout) abrir.
    for (let i = 0; i < 100 && !readTasks(root).length; i++) await new Promise((done) => setTimeout(done, 20));

    const edit = { cwd: root, tool_name: "Write", tool_input: { file_path: join(root, "src/greet.js"), content: "x" } };
    assert.deepEqual(hook(root, home, "pre-tool-use", edit), {
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason: "MOHs: nenhuma tarefa aberta permite escrever agora (tarefa T1 de scout aberta); rode mohs next",
      },
    });
    const copilot = hook(
      root,
      home,
      "pre-tool-use",
      { cwd: root, toolName: "create", toolArgs: { path: join(root, "src/x.js") } },
      "copilot",
    );
    assert.equal((copilot as { permissionDecision: string }).permissionDecision, "deny");
    assert.equal(
      hook(root, home, "pre-tool-use", { cwd: root, tool_name: "Read", tool_input: { file_path: join(root, "src/greet.js") } }),
      null,
    );

    const context = hook(root, home, "session-start", { cwd: root, source: "startup" }) as {
      hookSpecificOutput: { additionalContext: string };
    };
    assert.match(context.hookSpecificOutput.additionalContext, /climb 20260929-2200-hook está em andamento \(tarefa T1 de scout aberta\)/);

    const stops = [1, 2, 3, 4].map(() => hook(root, home, "stop", { cwd: root, stop_hook_active: false }));
    assert.deepEqual(
      stops.map((answer) => (answer as { decision?: string } | null)?.decision ?? "allow"),
      ["block", "block", "block", "allow"],
    );
    assert.equal(hook(root, home, "pre-tool-use", "not json" as never), null, "a broken payload never breaks the agent");
  });
});

describe("mohs agent install", () => {
  useMohsBin();

  it("merges the MOHs hooks into Claude Code settings without touching the team's own", () => {
    const root = tempProject();
    mkdirSync(join(root, ".claude"), { recursive: true });
    const team = {
      permissions: { allow: ["Bash(npm test)"] },
      hooks: { PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "./lint.sh" }] }] },
    };
    writeFileSync(join(root, ".claude/settings.json"), JSON.stringify(team));

    for (let i = 0; i < 2; i++)
      execFileSync(process.execPath, [CLI_ENTRY, "agent", "install", "claude", "--cwd", root], { encoding: "utf8" });
    const settings = JSON.parse(readFileSync(join(root, ".claude/settings.json"), "utf8"));
    assert.deepEqual(settings.permissions, team.permissions);
    assert.equal(settings.hooks.PreToolUse.length, 2, "the team's hook stays; reinstalling does not duplicate");
    assert.equal(settings.hooks.PreToolUse[0].hooks[0].command, "./lint.sh");
    assert.equal(settings.hooks.Stop[0].hooks[0].command, "mohs hook stop --for claude");
    assert.match(readFileSync(join(root, ".claude/skills/mohs/SKILL.md"), "utf8"), /name: mohs/);
  });

  it("writes a Copilot hooks file with handlers in Copilot's own shape", () => {
    const root = tempProject();
    execFileSync(process.execPath, [CLI_ENTRY, "agent", "install", "copilot", "--cwd", root], {
      encoding: "utf8",
      env: { ...process.env, MOHS_BIN: "mohs" },
    });
    const file = JSON.parse(readFileSync(join(root, ".github/hooks/mohs.json"), "utf8"));
    assert.equal(file.version, 1);
    assert.deepEqual(file.hooks.PreToolUse[0], {
      type: "command",
      matcher: "Read|Write|Edit|MultiEdit|NotebookEdit|Glob|Grep|Bash",
      bash: "mohs hook pre-tool-use --for copilot",
      powershell: "mohs hook pre-tool-use --for copilot",
      timeoutSec: 15,
    });
    assert.match(readFileSync(join(root, ".github/skills/mohs/SKILL.md"), "utf8"), /name: mohs/);
  });
});

function verdict(value: { allow: boolean; reason?: string }): string {
  return value.allow ? "allow" : (value.reason ?? "");
}

function readTasks(root: string): string[] {
  try {
    const climbs = join(root, ".mohs", "climbs");
    const [id] = readdirSync(climbs);
    return readdirSync(join(climbs, id, "tasks"));
  } catch {
    return [];
  }
}
