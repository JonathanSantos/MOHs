import { createHash } from "node:crypto";
import { existsSync, mkdirSync, realpathSync, rmSync, symlinkSync } from "node:fs";
import { basename, dirname, join, relative } from "node:path";
import { isDir, listDir, writeText } from "../util/fs.ts";
import { normalizePath } from "../util/glob.ts";
import { Git } from "./git.ts";

export interface Workspace {
  /** Where the project root lives inside the worktree: tools and commands run here. */
  root: string;
  worktree: string;
  branch: string;
  /** Commit the route started from, to count what it added. */
  base: string;
}

export interface Commit {
  hash: string;
  /** Files the commit changed, relative to the project root. */
  files: string[];
}

/** Everything but the work itself: dependencies are linked, never committed. */
const STAGE_PATHSPEC = ["--", ".", ":(exclude)node_modules", ":(exclude,glob)**/node_modules", ":(exclude,glob)**/.mohs/**"];

/**
 * One git worktree per route, outside the project so the project's own tools never scan it.
 * Git is an internal dependency: a project without git gets a private repository in `.mohs/git`.
 */
export class Worktrees {
  private readonly projectRoot: string;
  private readonly baseDir: string;
  private readonly git: Git;
  /** Project root relative to the repository top level ("" when they are the same folder). */
  private readonly prefix: string;

  private constructor(projectRoot: string, baseDir: string, git: Git, prefix: string) {
    this.projectRoot = projectRoot;
    this.baseDir = baseDir;
    this.git = git;
    this.prefix = prefix;
  }

  static async open(projectRoot: string, options: { baseDir: string; mohsDir: string }): Promise<Worktrees> {
    const probe = new Git({ cwd: projectRoot });
    const topLevel = await probe.tryRun(["rev-parse", "--show-toplevel"]);
    if (topLevel && (await probe.tryRun(["rev-parse", "--verify", "HEAD"]))) {
      // Compara caminhos canônicos: no macOS /var é symlink de /private/var, e o git devolve o resolvido.
      return new Worktrees(projectRoot, options.baseDir, probe, relative(realpathSync.native(topLevel), realpathSync.native(projectRoot)));
    }
    return new Worktrees(projectRoot, options.baseDir, await privateRepository(projectRoot, options.mohsDir), "");
  }

  /** The commit the project is at now: where a climb starts. */
  async projectHead(): Promise<string> {
    return this.git.run(["rev-parse", "HEAD"]);
  }

  /** A worktree on a new branch `mohs/<climb>/<name>`, starting from `from` (the project's HEAD by default). */
  async create(climbId: string, name: string, from = "HEAD"): Promise<Workspace> {
    const worktree = join(this.baseDir, projectSlug(this.projectRoot), climbId, name);
    const branch = `mohs/${climbId}/${name}`;
    mkdirSync(dirname(worktree), { recursive: true });
    const base = await this.git.run(["rev-parse", from]);
    await this.git.run(["worktree", "add", "-q", "-b", branch, worktree, base]);
    return this.prepareTree(worktree, branch, base);
  }

  /**
   * The workspace of a branch this climb created before, for a resumed climb: its worktree if the folder survived,
   * or a new one on the same branch. `base` is where the branch left `from`. Null when there is no such branch.
   */
  async adopt(climbId: string, name: string, from: string): Promise<Workspace | null> {
    const branch = `mohs/${climbId}/${name}`;
    if ((await this.git.tryRun(["rev-parse", "--verify", "-q", `refs/heads/${branch}`])) === null) return null;
    const worktree = join(this.baseDir, projectSlug(this.projectRoot), climbId, name);
    if (!isDir(worktree)) {
      await this.git.tryRun(["worktree", "prune"]);
      mkdirSync(dirname(worktree), { recursive: true });
      await this.git.run(["worktree", "add", "-q", worktree, branch]);
    }
    const base = await this.git.run(["merge-base", branch, from]);
    return this.prepareTree(worktree, branch, base);
  }

  /**
   * Merges `branch` into the workspace's branch. On a conflict the merge stays in progress, with the markers
   * in the files, for someone to resolve and commit; the conflicting files are returned.
   */
  async merge(
    workspace: Workspace,
    branch: string,
    message: string,
  ): Promise<{ ok: true; commit: string } | { ok: false; conflicts: string[] }> {
    const git = this.git.at(workspace.worktree);
    if (await git.merge(branch, message)) return { ok: true, commit: await git.run(["rev-parse", "--short", "HEAD"]) };
    const conflicts = (await git.run(["diff", "--name-only", "--diff-filter=U", "-z"])).split("\0").filter(Boolean);
    return { ok: false, conflicts: this.projectPaths(conflicts) };
  }

  /**
   * A throwaway detached checkout of `ref`, next to the route worktrees: where the belayer writes the seal
   * and where the sealed tests meet the code. Nothing in it is ever committed.
   */
  async scratch(climbId: string, name: string, ref = "HEAD"): Promise<Workspace> {
    const worktree = join(this.baseDir, projectSlug(this.projectRoot), climbId, name);
    mkdirSync(dirname(worktree), { recursive: true });
    const base = await this.git.run(["rev-parse", ref]);
    await this.git.run(["worktree", "add", "-q", "--detach", worktree, base]);
    return this.prepareTree(worktree, "", base);
  }

  /**
   * Links dependencies and takes the MOHs config out of the tree: it is not the agent's business. The files are
   * marked skip-worktree, so `git status` stays clean and no commit ever records them as deleted.
   */
  private async prepareTree(worktree: string, branch: string, base: string): Promise<Workspace> {
    const root = join(worktree, this.prefix);
    this.linkDependencies(root);
    const git = new Git({ cwd: root });
    const tracked = (await git.run(["ls-files", "-z", "--", ".mohs"])).split("\0").filter(Boolean);
    if (tracked.length) await git.run(["update-index", "--skip-worktree", "--", ...tracked]);
    rmSync(join(root, ".mohs"), { recursive: true, force: true });
    return { root, worktree, branch, base };
  }

  async head(workspace: Workspace): Promise<string> {
    return this.git.at(workspace.worktree).run(["rev-parse", "HEAD"]);
  }

  /** What a route changed since it started, with paths relative to the project root. */
  async diff(workspace: Workspace): Promise<string> {
    return new Git({ cwd: workspace.root }).run(["diff", "--relative", workspace.base, "HEAD"]);
  }

  /** Commits everything the route changed. Returns null when nothing changed. */
  async commit(workspace: Workspace, message: string): Promise<Commit | null> {
    const git = this.git.at(workspace.worktree);
    await git.run(["add", "-A", ...STAGE_PATHSPEC]);
    // -z: nomes com espaço ou acento chegam crus, sem as aspas do core.quotepath.
    const staged = (await git.run(["diff", "--cached", "--name-only", "-z"])).split("\0").filter(Boolean);
    // Um merge resolvido pode não mudar nada em relação ao HEAD, e ainda assim precisa do commit que o conclui.
    const merging = (await git.tryRun(["rev-parse", "-q", "--verify", "MERGE_HEAD"])) !== null;
    if (!staged.length && !merging) return null;
    await git.commit(message);
    return { hash: await git.run(["rev-parse", "--short", "HEAD"]), files: this.projectPaths(staged) };
  }

  async commitsSinceBase(workspace: Workspace): Promise<number> {
    return Number(await this.git.at(workspace.worktree).run(["rev-list", "--count", `${workspace.base}..HEAD`]));
  }

  /** Repository paths → project paths; files outside the project folder are left out. */
  private projectPaths(files: string[]): string[] {
    if (!this.prefix) return files;
    const prefix = `${normalizePath(this.prefix)}/`;
    return files.filter((file) => file.startsWith(prefix)).map((file) => file.slice(prefix.length));
  }

  /** Removes the folder; the branch stays, holding the route's commits. */
  async remove(workspace: Workspace): Promise<void> {
    await this.git.run(["worktree", "remove", "--force", workspace.worktree]);
  }

  /**
   * Links every `node_modules` (root and one level down, e.g. npm workspaces) into the worktree.
   * A junction on Windows needs no admin rights; elsewhere it is a plain symlink.
   */
  private linkDependencies(root: string): void {
    const candidates = ["node_modules", ...listDir(this.projectRoot).map((entry) => join(entry, "node_modules"))];
    for (const rel of candidates) {
      const source = join(this.projectRoot, rel);
      const target = join(root, rel);
      if (isDir(source) && isDir(dirname(target)) && !existsSync(target)) symlinkSync(source, target, "junction");
    }
  }
}

async function privateRepository(projectRoot: string, mohsDir: string): Promise<Git> {
  const gitDir = join(mohsDir, "git");
  const git = new Git({ cwd: projectRoot, gitDir, workTree: projectRoot });
  if (!isDir(gitDir)) {
    mkdirSync(gitDir, { recursive: true });
    await git.run(["init", "-q"]);
    writeText(join(gitDir, "info", "exclude"), ".mohs/\nnode_modules/\n**/node_modules/\n");
  }
  // Fotografa o estado atual do projeto: é dele que as routes partem.
  await git.run(["add", "-A"]);
  if ((await git.tryRun(["diff", "--cached", "--quiet"])) === null) await git.commit("mohs: snapshot do projeto");
  return git;
}

/** Folder name for a project under `~/.mohs`: readable, and unique per absolute path. */
export function projectSlug(projectRoot: string): string {
  const hash = createHash("sha256").update(projectRoot).digest("hex").slice(0, 8);
  return `${basename(projectRoot).replace(/[^\w.-]/g, "_")}-${hash}`;
}
