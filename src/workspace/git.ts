import { execFile } from "node:child_process";

export class GitError extends Error {}

export interface GitOptions {
  cwd: string;
  /** Private repository for projects without git: GIT_DIR, with the project as work tree. */
  gitDir?: string;
  workTree?: string;
}

/** Fallback identity, used only when the repository has none configured (fresh CI machines). */
const FALLBACK_IDENTITY = ["-c", "user.name=MOHs", "-c", "user.email=mohs@localhost"];

/** Thin wrapper over the git CLI. `execFile` (no shell), so arguments are never re-parsed on any OS. */
export class Git {
  private readonly options: GitOptions;

  constructor(options: GitOptions) {
    this.options = options;
  }

  at(cwd: string): Git {
    return new Git({ cwd });
  }

  run(args: readonly string[]): Promise<string> {
    const env = this.options.gitDir
      ? { ...process.env, GIT_DIR: this.options.gitDir, GIT_WORK_TREE: this.options.workTree ?? this.options.cwd }
      : process.env;
    return new Promise((resolve, reject) => {
      execFile(
        "git",
        [...args],
        { cwd: this.options.cwd, env, windowsHide: true, maxBuffer: 16 * 1024 * 1024 },
        (error, stdout, stderr) => {
          if (error) reject(new GitError(`git ${args.join(" ")}: ${(stderr || error.message).trim()}`));
          else resolve(stdout.trim());
        },
      );
    });
  }

  async tryRun(args: readonly string[]): Promise<string | null> {
    try {
      return await this.run(args);
    } catch {
      return null;
    }
  }

  async commit(message: string): Promise<void> {
    await this.run([...(await this.identity()), "commit", "--no-verify", "-q", "-m", message]);
  }

  /** Merges `ref` with a merge commit. Returns false when there are conflicts; the merge is left in progress. */
  async merge(ref: string, message: string): Promise<boolean> {
    return (await this.tryRun([...(await this.identity()), "merge", "--no-ff", "--no-verify", "-q", "-m", message, ref])) !== null;
  }

  private async identity(): Promise<string[]> {
    return (await this.tryRun(["config", "user.email"])) !== null ? [] : FALLBACK_IDENTITY;
  }
}
