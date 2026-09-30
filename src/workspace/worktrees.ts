import { createHash } from "node:crypto";
import { copyFileSync, type Dirent, existsSync, lstatSync, mkdirSync, readdirSync, realpathSync, rmSync, symlinkSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative } from "node:path";
import { isDir, listDir, readText, writeText } from "../util/fs.ts";
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

// Tudo menos as dependências, que são linkadas e nunca commitadas. Só excludes com glob: um exclude literal que nomeia
// um caminho ignorado (no Windows o node_modules linkado é uma junction, uma pasta que o git ignora) faz o git add
// falhar. Um glob pega o link; o outro, o conteúdo de uma pasta de verdade.
const STAGE_PATHSPEC = ["--", ".", ":(exclude,glob)**/node_modules", ":(exclude,glob)**/node_modules/**", ":(exclude,glob)**/.mohs/**"];

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
   * and where the sealed tests meet the code. Nothing in it is ever committed. One left behind by a Basecamp that
   * died (the belayer was still writing when the climb stopped) is thrown away first.
   */
  async scratch(climbId: string, name: string, ref = "HEAD"): Promise<Workspace> {
    const worktree = join(this.baseDir, projectSlug(this.projectRoot), climbId, name);
    if (isDir(worktree)) {
      await this.git.tryRun(["worktree", "remove", "--force", worktree]);
      rmSync(worktree, { recursive: true, force: true });
      await this.git.tryRun(["worktree", "prune"]);
    }
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

  /** What changed in the worktree: since its last commit (a pitch, untracked files included) or since the route began. */
  async changedFiles(workspace: Workspace, since: "commit" | "base" = "commit"): Promise<string[]> {
    const git = this.git.at(workspace.worktree);
    const names = (output: string) => output.split("\0").filter(Boolean);
    const files =
      since === "base"
        ? names(await git.run(["diff", "--name-only", "-z", workspace.base, "HEAD"]))
        : [
            ...names(await git.run(["diff", "--name-only", "-z", "HEAD"])),
            ...names(await git.run(["ls-files", "--others", "--exclude-standard", "-z"])),
          ];
    return this.projectPaths([...new Set(files)]).filter((file) => !file.split("/").includes("node_modules"));
  }

  /** What the route changed since it began, with git's status letter (A, M, D, R…) and the project path. */
  async statusSinceBase(workspace: Workspace): Promise<{ status: string; path: string }[]> {
    const fields = (await this.git.at(workspace.worktree).run(["diff", "--name-status", "-z", workspace.base, "HEAD"])).split("\0");
    const entries: { status: string; path: string }[] = [];
    for (let i = 0; i < fields.length - 1;) {
      const status = fields[i++];
      // Renomeação e cópia trazem dois caminhos: conta o de antes, que é o arquivo que existia.
      const path = fields[i++];
      if (/^[RC]/.test(status)) i++;
      const [projectPath] = this.projectPaths([path]);
      if (projectPath) entries.push({ status: status[0], path: projectPath });
    }
    return entries;
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
    linkDependencies(this.projectRoot, root);
  }
}

/**
 * Gives a checkout of the project the dependencies installed at its root. A `node_modules` whose packages are all
 * third-party is linked whole. One with links back into the project (yarn and npm workspaces link each package of the
 * monorepo there) becomes a real folder: third-party packages still link to the root, and each workspace package links
 * to the checkout's own copy. Otherwise `require("my-package")` would load the root's code, not the code being changed.
 */
export function linkDependencies(projectRoot: string, checkoutRoot: string): void {
  for (const rel of dependencyFolders(projectRoot)) {
    const target = join(checkoutRoot, rel);
    if (!isDir(dirname(target)) || existsSync(target)) continue;
    linkFolder(join(projectRoot, rel), target, projectRoot, checkoutRoot);
  }
}

function linkFolder(source: string, target: string, projectRoot: string, checkoutRoot: string): void {
  const entries = readdirSync(source, { withFileTypes: true });
  const back = (entry: Dirent) => workspaceTarget(join(source, entry.name), projectRoot, checkoutRoot);
  const isScope = (entry: Dirent) => entry.isDirectory() && entry.name.startsWith("@");
  const pointsBack = entries.some(
    (entry) =>
      back(entry) !== null ||
      (isScope(entry) &&
        readdirSync(join(source, entry.name), { withFileTypes: true }).some(
          (inner) => workspaceTarget(join(source, entry.name, inner.name), projectRoot, checkoutRoot) !== null,
        )),
  );
  if (!pointsBack) {
    symlinkSync(source, target, "junction");
    return;
  }
  mkdirSync(target, { recursive: true });
  for (const entry of entries) {
    const from = join(source, entry.name);
    const to = join(target, entry.name);
    const own = back(entry);
    if (own) symlinkSync(own, to, "junction");
    else if (isScope(entry)) linkFolder(from, to, projectRoot, checkoutRoot);
    else if (entry.isFile()) copyFileSync(from, to);
    else symlinkSync(from, to, "junction");
  }
}

/** The checkout's copy of a workspace package, when `path` is a link from node_modules back into the project. */
function workspaceTarget(path: string, projectRoot: string, checkoutRoot: string): string | null {
  if (!lstatSync(path).isSymbolicLink()) return null;
  let real: string;
  try {
    real = realpathSync(path);
  } catch {
    return null;
  }
  const inside = relative(realpathSync(projectRoot), real);
  if (!inside || inside.startsWith("..") || isAbsolute(inside) || inside.split(/[\\/]/).includes("node_modules")) return null;
  const own = join(checkoutRoot, inside);
  return existsSync(own) ? own : null;
}

/**
 * Every `node_modules` a checkout of the project needs, relative to its root: the root's, one level down, and each
 * workspace package's (`packages/*` in package.json `workspaces`), where yarn and npm keep the versions they could not
 * hoist. A monorepo like React has a dozen of those; without them its tests do not run in a worktree.
 */
export function dependencyFolders(projectRoot: string): string[] {
  const workspaces = workspacePackages(projectRoot);
  const candidates = [
    "node_modules",
    ...listDir(projectRoot).map((entry) => join(entry, "node_modules")),
    ...workspaces.map((dir) => join(dir, "node_modules")),
  ];
  return [...new Set(candidates)].filter((rel) => isDir(join(projectRoot, rel)));
}

/** The packages of a monorepo (`workspaces` in package.json, `dir/*` expanded), relative to the root; none otherwise. */
export function workspacePackages(projectRoot: string): string[] {
  return readWorkspaces(projectRoot)
    .flatMap((pattern) => {
      const clean = pattern.replace(/\/+$/, "");
      if (!clean.endsWith("/*")) return [clean];
      const parent = clean.slice(0, -2);
      return listDir(join(projectRoot, parent)).map((entry) => `${parent}/${entry}`);
    })
    .filter((dir) => isDir(join(projectRoot, dir)));
}

/** The packages these files belong to: what a monorepo's tests are scoped to (`{packages}` in a command). */
export function packagesOf(files: readonly string[], packages: readonly string[]): string[] {
  return [...new Set(files.flatMap((file) => packages.filter((dir) => file === dir || file.startsWith(`${dir}/`))))];
}

/** Workspace globs from package.json (npm, yarn) or pnpm-workspace.yaml; `**` globs are left out. */
function readWorkspaces(projectRoot: string): string[] {
  const usable = (list: unknown[]) =>
    list.filter((entry): entry is string => typeof entry === "string" && !entry.includes("**") && !entry.startsWith("!"));
  const pnpm = readText(join(projectRoot, "pnpm-workspace.yaml"));
  if (pnpm !== null) {
    const block = /^packages:\s*\n((?:\s+-.*\n?)+)/m.exec(pnpm)?.[1] ?? "";
    return usable([...block.matchAll(/^\s+-\s*['"]?([^'"#\n]+?)['"]?\s*$/gm)].map((match) => match[1]));
  }
  try {
    const pkg = JSON.parse(readText(join(projectRoot, "package.json")) ?? "{}") as { workspaces?: string[] | { packages?: string[] } };
    return usable(Array.isArray(pkg.workspaces) ? pkg.workspaces : (pkg.workspaces?.packages ?? []));
  } catch {
    return [];
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
  // O repositório é do MOHs, não do projeto: os arquivos voltam byte a byte, sem conversão de fim de linha (no Windows,
  // core.autocrlf=true trocaria LF por CRLF nos worktrees). Vale também para repositórios criados antes disto.
  await git.run(["config", "core.autocrlf", "false"]);
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
