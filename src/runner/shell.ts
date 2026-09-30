import { spawn, spawnSync, type ChildProcess } from "node:child_process";

export interface ExecResult {
  code: number;
  /** Tail of stdout and stderr interleaved, enough to diagnose without flooding the model's context. */
  output: string;
  timedOut: boolean;
  ms: number;
}

const MAX_OUTPUT_CHARS = 12_000;

/**
 * Runs a command through the platform shell, so `npm run x` resolves `npm.cmd` on Windows.
 * On timeout the whole process tree is killed, not only the shell.
 */
export function runShell(command: string, options: { cwd: string; timeoutMs: number; env?: NodeJS.ProcessEnv }): Promise<ExecResult> {
  const started = Date.now();
  return new Promise((resolve) => {
    const child = spawn(command, {
      cwd: options.cwd,
      env: projectEnv(options.env),
      shell: true,
      windowsHide: true,
      // Grupo de processos próprio no POSIX, para matar filhos e netos juntos no timeout.
      detached: process.platform !== "win32",
    });
    let output = "";
    const collect = (chunk: Buffer) => {
      output = (output + chunk.toString("utf8")).slice(-MAX_OUTPUT_CHARS * 2);
    };
    child.stdout?.on("data", collect);
    child.stderr?.on("data", collect);

    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      killTree(child);
    }, options.timeoutMs);

    const finish = (code: number) => {
      clearTimeout(timer);
      resolve({ code, output: tail(output), timedOut, ms: Date.now() - started });
    };
    child.on("error", (error) => {
      output += `\n${error.message}`;
      finish(127);
    });
    child.on("close", (code) => finish(timedOut ? 124 : (code ?? 1)));
  });
}

/**
 * The project's commands run as if from a clean terminal. NODE_TEST_CONTEXT is dropped: a `node --test` started from
 * inside another node:test run (the MOHs itself under test, or a hook) would report to that run and never fail.
 */
function projectEnv(extra: NodeJS.ProcessEnv | undefined): NodeJS.ProcessEnv {
  const { NODE_TEST_CONTEXT: _inherited, ...env } = process.env;
  return { ...env, CI: "1", FORCE_COLOR: "0", ...extra };
}

function killTree(child: ChildProcess): void {
  if (!child.pid) return;
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], { windowsHide: true });
    return;
  }
  try {
    process.kill(-child.pid, "SIGKILL");
  } catch {
    child.kill("SIGKILL");
  }
}

function tail(text: string): string {
  const clean = text.replace(/\x1b\[[0-9;]*m/g, "");
  return clean.length > MAX_OUTPUT_CHARS ? `…(saída cortada)\n${clean.slice(-MAX_OUTPUT_CHARS)}` : clean;
}
