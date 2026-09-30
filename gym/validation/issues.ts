// O gym de issues reais: cada issue aponta um repositório, o commit de antes da correção (base) e o da correção
// (referência). A suíte escondida são os testes que a referência trouxe, e ela só entra no banco depois de conferida:
// falha na base e passa inteira na referência.
import { execFileSync, spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { linkDependencies } from "../../src/workspace/worktrees.ts";
import type { Intent } from "../../src/domain/types.ts";

const REPO = fileURLToPath(new URL("../../", import.meta.url));
export const ISSUES_DIR = join(REPO, "gym", "issues");

export interface IssueSpec {
  id: string;
  /** Three words for the validation's folder name. */
  keywords: [string, string, string];
  repo: string;
  /** The commit before the fix: what every arm starts from. */
  base: string;
  /** The commit whose tests are the hidden suite. */
  reference: string;
  intent: Intent;
  /** The standardized request, written from the issue: the same for every arm. */
  request: string;
  hidden: { command: string; files: string[] };
  /** The project's own suite for an arm (a monorepo's root suite is too big). */
  projectTest: string;
  source: string[];
}

export interface IssueCounts {
  pass: number;
  fail: number;
  total: number;
}

export function loadIssue(id: string): IssueSpec {
  const file = join(ISSUES_DIR, `${id}.json`);
  if (!existsSync(file)) throw new Error(`issue desconhecida: ${id}. Issues: ${listIssues().join(", ") || "nenhuma"}`);
  return JSON.parse(readFileSync(file, "utf8")) as IssueSpec;
}

export function listIssues(): string[] {
  return existsSync(ISSUES_DIR)
    ? readdirSync(ISSUES_DIR)
        .filter((file) => file.endsWith(".json"))
        .map((file) => file.slice(0, -".json".length))
        .sort()
    : [];
}

function home(): string {
  return join(process.env.MOHS_HOME ?? join(homedir(), ".mohs"), "validation");
}

/** Where an issue's template (the base, with its dependencies) and its hidden suite live: outside the repository. */
export function issueDir(id: string): string {
  return join(home(), "issues", id);
}

export interface PreparedIssue {
  template: string;
  hidden: string;
  base: IssueCounts;
  reference: IssueCounts;
}

/**
 * Clones the repository (once, blobs on demand), extracts the base with its dependencies, builds the hidden suite from
 * the reference and checks it: some test must fail on the base and all must pass on the reference. An issue that fails
 * the check does not measure anything and is refused.
 */
export function prepareIssue(spec: IssueSpec, install: (dir: string) => void): PreparedIssue {
  const repo = cloneOnce(spec.repo);
  const dir = issueDir(spec.id);
  const template = join(dir, "template");
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(template, { recursive: true });
  extract(repo, spec.base, template);
  install(template);

  const hidden = join(dir, "hidden");
  mkdirSync(hidden, { recursive: true });
  const files: Record<string, string> = {};
  for (const path of spec.hidden.files) {
    const name = basename(path);
    writeFileSync(join(hidden, name), git(repo, "show", `${spec.reference}:${path}`));
    files[path] = name;
  }
  writeFileSync(join(hidden, "hidden.json"), JSON.stringify({ command: spec.hidden.command, files }, null, 2));

  const base = runHidden(template, template, hidden, spec.hidden.command);
  const referenceTree = mkdtempSync(join(tmpdir(), "mohs-issue-ref-"));
  try {
    extract(repo, spec.reference, referenceTree);
    const reference = runHidden(referenceTree, template, hidden, spec.hidden.command);
    const prepared = { template, hidden, base, reference };
    writeFileSync(join(dir, "verified.json"), JSON.stringify({ base, reference, at: new Date().toISOString() }, null, 2));
    if (!base.fail) throw new Error(`${spec.id}: a suíte escondida passa inteira na base (${base.pass}/${base.total}); não mede nada`);
    if (reference.fail || !reference.total)
      throw new Error(`${spec.id}: a suíte escondida falha na referência (${reference.fail} de ${reference.total})`);
    return prepared;
  } finally {
    rmSync(referenceTree, { recursive: true, force: true });
  }
}

/** A copy of `tree` with the hidden files in place and the template's dependencies linked, where the suite runs. */
function runHidden(tree: string, template: string, hidden: string, command: string): IssueCounts {
  const out = mkdtempSync(join(tmpdir(), "mohs-issue-run-"));
  try {
    cpSync(tree, out, { recursive: true, filter: (src) => !/[\\/](\.git|node_modules)$/.test(src) });
    linkDependencies(template, out);
    const spec = JSON.parse(readFileSync(join(hidden, "hidden.json"), "utf8")) as { files: Record<string, string> };
    for (const [to, from] of Object.entries(spec.files)) {
      mkdirSync(dirname(join(out, to)), { recursive: true });
      cpSync(join(hidden, from), join(out, to));
    }
    const { NODE_TEST_CONTEXT: _inherited, ...env } = process.env;
    const result = spawnSync(command, { cwd: out, encoding: "utf8", env, shell: true, maxBuffer: 64 * 1024 * 1024 });
    return jestCounts(`${result.stdout ?? ""}${result.stderr ?? ""}`);
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
}

function jestCounts(output: string): IssueCounts {
  const line = /^Tests:\s+(.*?)(\d+) total/m.exec(output);
  if (!line) return { pass: 0, fail: 0, total: 0 };
  const of = (word: string) => Number(new RegExp(`(\\d+) ${word}`).exec(line[1])?.[1] ?? 0);
  return { pass: of("passed"), fail: of("failed"), total: Number(line[2]) };
}

/** The repository, cloned once per machine without old blobs (they come when a commit needs them). */
function cloneOnce(url: string): string {
  const dir = join(
    home(),
    "repos",
    url
      .replace(/^https?:\/\//, "")
      .replace(/\.git$/, "")
      .replace(/[^\w.-]+/g, "_"),
  );
  if (!existsSync(join(dir, ".git"))) {
    mkdirSync(dirname(dir), { recursive: true });
    execFileSync("git", ["clone", "-q", "--filter=blob:none", url, dir], { stdio: "ignore" });
  }
  return dir;
}

/** The tree of a commit, without git: an arm starts from files, as any project would. */
function extract(repo: string, ref: string, to: string): void {
  const archive = join(tmpdir(), `mohs-issue-${process.pid}-${Date.now()}.tar`);
  git(repo, "archive", "--format=tar", "-o", archive, ref);
  try {
    execFileSync("tar", ["-xf", archive, "-C", to]);
  } finally {
    rmSync(archive, { force: true });
  }
}

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
}
