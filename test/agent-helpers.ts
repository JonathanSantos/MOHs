import { after, before, type TestContext } from "node:test";
import { Basecamp } from "../src/basecamp/basecamp.ts";
import { FileDesk } from "../src/basecamp/desk.ts";
import { climbDir } from "../src/basecamp/event-log.ts";
import type { Hardness } from "../src/domain/types.ts";
import { runCli } from "../src/cli/main.ts";
import { LocalRunner } from "../src/runner/local-runner.ts";
import { FileBoard } from "../src/tasks/file-board.ts";
import { TaskCrew } from "../src/tasks/task-crew.ts";
import { load, tempProject } from "./helpers.ts";

/** Runs the real CLI in this process, as an agent would from its shell, and captures what it prints. */
export async function mohs(root: string, ...args: string[]): Promise<{ code: number; out: string }> {
  const lines: string[] = [];
  const { log, error } = console;
  console.log = console.error = (...parts: unknown[]) => lines.push(parts.join(" "));
  try {
    const waits = ["next", "call"].includes(args[0]) ? ["--wait", "30"] : [];
    const code = await runCli([...args, "--cwd", root, ...waits]);
    return { code, out: lines.join("\n") };
  } finally {
    Object.assign(console, { log, error });
  }
}

/** The Basecamp in this process, with the file board the CLI talks to. It stops waiting when the test ends. */
export function agentClimb(
  root: string,
  t: TestContext,
  climbId: string,
  request = "Trocar a saudação para oi",
  hardness?: Hardness,
  { solo }: { solo?: boolean } = {},
) {
  const config = load(root);
  const stop = new AbortController();
  t.after(() => stop.abort());
  const options = { pollMs: 20, signal: stop.signal };
  return new Basecamp({
    config,
    climbId,
    crew: new TaskCrew({ config, board: new FileBoard({ climbDir: climbDir(config.mohsDir, climbId), ...options }) }),
    runner: new LocalRunner({ config, climbId, worktreesDir: tempProject(), sealsDir: tempProject() }),
    desk: new FileDesk(options),
    request,
    hardness,
    solo,
  });
}

/** Printed commands start with plain `mohs`, however the tests were started. */
export function useMohsBin(): void {
  let previous: string | undefined;
  before(() => {
    previous = process.env.MOHS_BIN;
    process.env.MOHS_BIN = "mohs";
  });
  after(() => {
    if (previous === undefined) delete process.env.MOHS_BIN;
    else process.env.MOHS_BIN = previous;
  });
}

/** Where a task says to work: the worktree for writing roles, the project for the others. */
export function workDir(out: string): string {
  const match = /Onde trabalhar: (.+?)(?: \(branch|$)/m.exec(out);
  if (!match) throw new Error(`no working directory in:\n${out}`);
  return match[1].trim();
}
