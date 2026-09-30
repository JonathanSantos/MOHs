import { execFileSync } from "node:child_process";
import { tempProject } from "./helpers.ts";

export function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

/** A real git repository with one commit, ready for worktrees. */
export function gitProject(files: Record<string, string>): string {
  const root = tempProject(files);
  git(root, "init", "-q", "-b", "main");
  git(root, "config", "user.email", "test@mohs.dev");
  git(root, "config", "user.name", "MOHs test");
  git(root, "add", "-A");
  git(root, "commit", "-q", "-m", "inicial");
  return root;
}
