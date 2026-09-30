import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { defaultUserDir } from "../config/paths.ts";
import type { ResolvedConfig } from "../config/types.ts";
import type {
  AnchorResult,
  AnchorVerify,
  Delivery,
  ExecResult,
  IntegrationMerge,
  Runner,
  RouteWorkspace,
  SealedFile,
  SealedTests,
  SendFailure,
  SendResult,
} from "../crew/types.ts";
import type { PlannedRoute } from "../domain/plan.ts";
import { surveyRepository, type SurveyResult } from "../survey/survey.ts";
import { readText } from "../util/fs.ts";
import { packagesOf, projectSlug, workspacePackages, Worktrees, type Workspace } from "../workspace/worktrees.ts";
import { builtInCovers, builtInSealCommand, describeBuiltInSeal } from "./seal-runners.ts";
import { runShell } from "./shell.ts";

/**
 * In a check command, the monorepo packages the change touched: `{packages}` as paths (npm test -- {packages}),
 * `{filters}` as `--filter=./path` (pnpm and turbo).
 */
const SCOPES: Record<string, (packages: readonly string[]) => string> = {
  "{packages}": (packages) => packages.join(" "),
  "{filters}": (packages) => packages.map((dir) => `--filter=./${dir}`).join(" "),
};
const isScoped = (command: string) => Object.keys(SCOPES).some((placeholder) => command.includes(placeholder));

export interface LocalRunnerOptions {
  config: ResolvedConfig;
  climbId: string;
  /** Where worktrees live. Default: `<MOHS_HOME or ~/.mohs>/worktrees`. */
  worktreesDir?: string;
  /** Where sealed tests are kept, away from the project and every worktree. Default: `<MOHS_HOME or ~/.mohs>/seals`. */
  sealsDir?: string;
}

/** Next to the kept seal: which files are tests (unit, e2e) and which are support. */
const SEAL_MANIFEST = ".seal.json";

/** Only the end of a failing test's output reaches the belayer: the assertion is almost always there. */
const FAILURE_TAIL = 4_000;
/** Where the reproduction lives among the seals: kept and checked the same way, with no route of its own. */
const REPRO = { id: "_repro", name: "reprodução" } as PlannedRoute;

/**
 * Runs the real thing on this machine: survey, one worktree per route, anchor commands and commits,
 * and the sealed tests, which only ever meet the code in throwaway checkouts.
 */
export class LocalRunner implements Runner {
  private readonly options: LocalRunnerOptions;
  private readonly workspaces = new Map<string, Workspace>();
  private readonly sealWorkspaces = new Map<string, Workspace>();
  private readonly sealed = new Map<string, SealedTests>();
  /** The reproduction of a bug, and the route whose send runs it. */
  private repro?: { route: string; files: SealedFile[] };
  /** Route branches, kept after their worktrees are gone, for the merge into the delivery branch. */
  private readonly branches = new Map<string, string>();
  private worktrees?: Promise<Worktrees>;
  /** Where the climb started; the delivery branch grows from here. */
  private climbBase?: Promise<string>;
  private delivery?: Promise<Workspace>;

  constructor(options: LocalRunnerOptions) {
    this.options = options;
  }

  async survey(): Promise<SurveyResult> {
    return surveyRepository(this.options.config.projectRoot);
  }

  /** Without `commands.seal`, sealed files run by extension (node, python3, sh); other stacks must say how. */
  riggingProblem(survey: SurveyResult): string | null {
    const languages = survey.languages ?? [];
    if (this.options.config.settings.commands.seal || builtInCovers(languages)) return null;
    return `para quartz e diamond neste projeto (${languages.join(", ")}), diga no mohs.yaml como rodar um arquivo de teste: commands.seal (ex.: "go test {file}"). Sem isso, o MOHs só roda sozinho ${describeBuiltInSeal()}`;
  }

  /** A route starts from the delivery branch when there is one: earlier routes, including its dependencies, are there. */
  async prepare(route: PlannedRoute): Promise<RouteWorkspace> {
    const worktrees = await this.openWorktrees();
    const from = this.delivery ? (await this.delivery).branch : await this.base();
    // Um climb retomado reencontra a branch (e o worktree) que a route já tinha, com o trabalho que ficou nela.
    const workspace =
      (await worktrees.adopt(this.options.climbId, route.id, from)) ?? (await worktrees.create(this.options.climbId, route.id, from));
    this.workspaces.set(route.id, workspace);
    this.branches.set(route.id, workspace.branch);
    return { path: workspace.root, branch: workspace.branch };
  }

  /** Runs each anchor command in order and stops at the first failure; if all pass, commits the pitch. */
  async anchor(
    route: PlannedRoute,
    pitch: number,
    _attempt: number,
    commands: readonly string[],
    verify?: AnchorVerify,
  ): Promise<AnchorResult> {
    const workspace = this.workspaceOf(route);
    const { passed, failed } = await this.runChecks(workspace, commands, "commit");
    if (failed) return failed;
    const problem = await verify?.((command) => this.exec(route, command));
    if (problem) return { ok: false, checks: passed, output: problem };
    const title = route.pitches[pitch - 1]?.title ?? `pitch ${pitch}`;
    const commit = await (await this.openWorktrees()).commit(workspace, `mohs(${route.id}): ${title}`);
    return { ok: true, checks: passed, commit: commit?.hash, files: commit?.files };
  }

  async exec(route: PlannedRoute, command: string): Promise<ExecResult> {
    const { code, output } = await this.run(command, this.workspaceOf(route).root);
    return { code, output };
  }

  async prepareSeal(route: PlannedRoute): Promise<RouteWorkspace> {
    await this.dropSealWorkspace(route);
    const workspace = await (await this.openWorktrees()).scratch(this.options.climbId, `${route.id}.seal`);
    this.sealWorkspaces.set(route.id, workspace);
    return { path: workspace.root };
  }

  /** Stores the seal away from the project, drops the belayer's checkout and runs every sealed file on the current code. */
  async sealRed(route: PlannedRoute, sealed: SealedTests): Promise<{ allRed: boolean; passing: string[] }> {
    this.sealed.set(route.id, sealed);
    this.keep(route, sealed.files);
    await this.dropSealWorkspace(route);
    const failures = await this.withSealed(route, "HEAD", "red", async (root) => this.runSealed(root, sealed.files));
    const failing = new Set(failures.map((failure) => failure.test));
    const passing = sealed.files.filter((file) => file.kind !== "support" && !failing.has(file.path)).map((file) => file.path);
    return { allRed: passing.length === 0, passing };
  }

  /** Sealed tests (and, for diamond, the full suite) on the route's last commit, never in the climber's worktree. */
  async send(route: PlannedRoute, attempt: number, commands: readonly string[]): Promise<SendResult> {
    // A route da correção também roda o teste de reprodução, que precisa passar agora.
    const sealed = [...(this.sealed.get(route.id)?.files ?? []), ...(this.repro?.route === route.id ? this.repro.files : [])];
    const failures = await this.withSealed(
      route,
      this.workspaceOf(route).branch,
      `send-${attempt}`,
      async (root) => [...(await this.runSealed(root, sealed)), ...(await this.runSuite(root, commands))],
      sealed,
    );
    return { ok: failures.length === 0, total: sealed.filter((file) => file.kind !== "support").length + commands.length, failures };
  }

  // ── reprodução ────────────────────────────────────────────────────────

  async prepareRepro(): Promise<RouteWorkspace> {
    return this.prepareSeal(REPRO);
  }

  /** Keeps the reproduction away from the project and runs each file on the code as it is: all must fail. */
  async reproRed(files: readonly SealedFile[]): Promise<{ allRed: boolean; passing: string[]; output: string }> {
    this.keep(REPRO, files);
    await this.dropSealWorkspace(REPRO);
    const failures = await this.withSealed(REPRO, "HEAD", "red", async (root) => this.runSealed(root, files), files);
    const failing = new Set(failures.map((failure) => failure.test));
    const passing = files.filter((file) => file.kind !== "support" && !failing.has(file.path)).map((file) => file.path);
    const output = failures.map((failure) => `${failure.test}:\n${failure.output}`).join("\n");
    return { allRed: passing.length === 0, passing, output: output.slice(-FAILURE_TAIL) };
  }

  async restoreRepro(): Promise<SealedFile[] | null> {
    const kept = await this.restoreSeal(REPRO);
    return kept?.files.length ? kept.files : null;
  }

  setRepro(route: PlannedRoute, files: readonly SealedFile[]): void {
    this.repro = { route: route.id, files: [...files] };
  }

  /** Writes tests into the route's worktree and commits them; a file the climber wrote differently is left alone. */
  async adoptTests(route: PlannedRoute, files: readonly SealedFile[], message: string): Promise<{ adopted: string[]; skipped: string[] }> {
    const workspace = this.workspaceOf(route);
    const adopted: string[] = [];
    const skipped: string[] = [];
    for (const file of files) {
      const existing = readText(join(workspace.root, file.path));
      if (existing !== null && existing !== file.content) skipped.push(file.path);
      else {
        write(workspace.root, file);
        adopted.push(file.path);
      }
    }
    if (adopted.length) await (await this.openWorktrees()).commit(workspace, message);
    return { adopted, skipped };
  }

  async statusSinceBase(route: PlannedRoute): Promise<{ status: string; path: string }[]> {
    return (await this.openWorktrees()).statusSinceBase(this.workspaceOf(route));
  }

  /** Each file must fail on the route's base (a checkout of it, with the file) and pass in the route's worktree. */
  async reproduces(route: PlannedRoute, paths: readonly string[]): Promise<{ path: string; failedBefore: boolean; passesNow: boolean }[]> {
    const workspace = this.workspaceOf(route);
    const results: { path: string; failedBefore: boolean; passesNow: boolean }[] = [];
    for (const path of paths) {
      const content = readText(join(workspace.root, path));
      if (content === null) {
        results.push({ path, failedBefore: false, passesNow: false });
        continue;
      }
      const file: SealedFile = { path, content, kind: "unit" };
      const before = await this.withSealed(route, workspace.base, "repro-antes", async (root) => this.runSealed(root, [file]), [file]);
      const now = await this.run(this.fileCommand(file), workspace.root);
      results.push({ path, failedBefore: before.length > 0, passesNow: now.code === 0 });
    }
    return results;
  }

  async diff(route: PlannedRoute): Promise<string> {
    return (await this.openWorktrees()).diff(this.workspaceOf(route));
  }

  async head(route: PlannedRoute): Promise<string> {
    return (await this.openWorktrees()).head(this.workspaceOf(route));
  }

  async integrate(route: PlannedRoute): Promise<IntegrationMerge> {
    // Retomado depois do summit, o runner não viu a route subir: a branch tem o nome de sempre.
    const branch = this.branches.get(route.id) ?? `mohs/${this.options.climbId}/${route.id}`;
    return (await this.openWorktrees()).merge(await this.openDelivery(), branch, `mohs: integra a route ${route.id} (${route.name})`);
  }

  async deliveryWorkspace(): Promise<RouteWorkspace> {
    const delivery = await this.openDelivery();
    return { path: delivery.root, branch: delivery.branch };
  }

  async anchorDelivery(_attempt: number, commands: readonly string[], message: string): Promise<AnchorResult> {
    const delivery = await this.openDelivery();
    const { passed, failed } = await this.runChecks(delivery, commands, "base");
    if (failed) return failed;
    const commit = await (await this.openWorktrees()).commit(delivery, message);
    return { ok: true, checks: passed, commit: commit?.hash, files: commit?.files };
  }

  /**
   * Runs each check in order and stops at the first failure. In a monorepo, `{packages}` and `{filters}` become the
   * workspace packages the change touched; a scoped check with no package touched has nothing to run.
   */
  private async runChecks(
    workspace: Workspace,
    commands: readonly string[],
    since: "commit" | "base",
  ): Promise<{ passed: string[]; failed?: AnchorResult }> {
    const scoped = commands.some(isScoped)
      ? packagesOf(await (await this.openWorktrees()).changedFiles(workspace, since), workspacePackages(this.options.config.projectRoot))
      : [];
    const passed: string[] = [];
    for (const template of commands) {
      if (isScoped(template) && !scoped.length) continue;
      const command = Object.entries(SCOPES).reduce(
        (text, [placeholder, expand]) => text.replaceAll(placeholder, expand(scoped)),
        template,
      );
      const result = await this.run(command, workspace.root);
      if (result.code !== 0) {
        const why = result.timedOut ? "tempo esgotado" : `código ${result.code}`;
        return { passed, failed: { ok: false, checks: [...passed, command], output: `${command} falhou (${why})\n${result.output}` } };
      }
      passed.push(command);
    }
    return { passed };
  }

  async sendDelivery(attempt: number, commands: readonly string[]): Promise<SendResult> {
    const delivery = await this.openDelivery();
    const files = [...this.sealed.entries()].flatMap(([route, sealed]) => sealed.files.map((file) => ({ ...file, route })));
    const worktrees = await this.openWorktrees();
    const checkout = await worktrees.scratch(this.options.climbId, `entrega.send-${attempt}`, delivery.branch);
    try {
      for (const file of files) write(checkout.root, file);
      const failures = [...(await this.runSealed(checkout.root, files)), ...(await this.runSuite(checkout.root, commands))];
      return { ok: failures.length === 0, total: files.filter((file) => file.kind !== "support").length + commands.length, failures };
    } finally {
      await worktrees.remove(checkout);
    }
  }

  async finishDelivery(): Promise<Delivery> {
    if (!this.delivery) return {};
    const delivery = await this.delivery;
    const worktrees = await this.openWorktrees();
    const commits = await worktrees.commitsSinceBase(delivery);
    await worktrees.remove(delivery);
    return { branch: delivery.branch, commits };
  }

  async finish(route: PlannedRoute): Promise<Delivery> {
    await this.dropSealWorkspace(route);
    const workspace = this.workspaces.get(route.id);
    if (!workspace) return {};
    const worktrees = await this.openWorktrees();
    const commits = await worktrees.commitsSinceBase(workspace);
    await worktrees.remove(workspace);
    this.workspaces.delete(route.id);
    return { branch: workspace.branch, commits };
  }

  // ── sealed tests ──────────────────────────────────────────────────────

  /** A throwaway checkout of `ref` with the sealed files in place, removed as soon as `work` is done. */
  private async withSealed<T>(
    route: PlannedRoute,
    ref: string,
    label: string,
    work: (root: string) => Promise<T>,
    files: readonly SealedFile[] = this.sealed.get(route.id)?.files ?? [],
  ): Promise<T> {
    const worktrees = await this.openWorktrees();
    const checkout = await worktrees.scratch(this.options.climbId, `${route.id}.${label}`, ref);
    try {
      for (const file of files) write(checkout.root, file);
      return await work(checkout.root);
    } finally {
      await worktrees.remove(checkout);
    }
  }

  /** Runs each sealed test file; support files (helpers the tests import) are written but not run. */
  private async runSealed(root: string, files: readonly (SealedFile & { route?: string })[]): Promise<SendFailure[]> {
    const failures: SendFailure[] = [];
    for (const file of files.filter((f) => f.kind !== "support")) {
      const result = await this.run(this.fileCommand(file), root);
      if (result.code !== 0) failures.push({ test: file.path, output: result.output.slice(-FAILURE_TAIL), route: file.route });
    }
    return failures;
  }

  private async runSuite(root: string, commands: readonly string[]): Promise<SendFailure[]> {
    const failures: SendFailure[] = [];
    for (const command of commands) {
      const result = await this.run(command, root);
      if (result.code !== 0) failures.push({ test: command, output: result.output.slice(-FAILURE_TAIL) });
    }
    return failures;
  }

  private fileCommand(file: SealedFile): string {
    const { seal, sealE2e } = this.options.config.settings.commands;
    const template = (file.kind === "e2e" ? sealE2e : undefined) ?? seal ?? builtInSealCommand(file.path);
    if (!template) throw new Error(`No way to run ${file.path}: commands.seal is not set and no built-in runner takes it`);
    return template.replaceAll("{file}", JSON.stringify(file.path));
  }

  /**
   * A copy outside the project, for audit and for resuming the climb: the climber's worktree never holds a sealed file.
   * The manifest says which files are tests and which are support.
   */
  private keep(route: PlannedRoute, files: readonly SealedFile[]): void {
    const dir = this.sealDir(route);
    for (const file of files) write(dir, file);
    writeFileSync(join(dir, SEAL_MANIFEST), JSON.stringify(files.map(({ path, kind }) => ({ path, kind }))));
  }

  private sealDir(route: PlannedRoute): string {
    const { config, climbId, sealsDir = join(defaultUserDir(), "seals") } = this.options;
    return join(sealsDir, projectSlug(config.projectRoot), climbId, route.id);
  }

  private async dropSealWorkspace(route: PlannedRoute): Promise<void> {
    const workspace = this.sealWorkspaces.get(route.id);
    if (!workspace) return;
    this.sealWorkspaces.delete(route.id);
    await (await this.openWorktrees()).remove(workspace);
  }

  // ── plumbing ──────────────────────────────────────────────────────────

  private run(command: string, cwd: string) {
    return runShell(command, { cwd, timeoutMs: this.options.config.settings.commands.timeoutMs });
  }

  private workspaceOf(route: PlannedRoute): Workspace {
    const workspace = this.workspaces.get(route.id);
    if (!workspace) throw new Error(`Route "${route.id}" has no workspace; prepare() must run first`);
    return workspace;
  }

  private async base(): Promise<string> {
    this.climbBase ??= this.openWorktrees().then((worktrees) => worktrees.projectHead());
    return this.climbBase;
  }

  private openDelivery(): Promise<Workspace> {
    this.delivery ??= (async () => {
      const worktrees = await this.openWorktrees();
      const base = await this.base();
      return (await worktrees.adopt(this.options.climbId, "entrega", base)) ?? worktrees.create(this.options.climbId, "entrega", base);
    })();
    return this.delivery;
  }

  /** The delivery branch, when an earlier run of this climb created it: routes of a resumed climb start from it. */
  async resumeDelivery(): Promise<void> {
    const worktrees = await this.openWorktrees();
    const base = await this.base();
    const adopted = await worktrees.adopt(this.options.climbId, "entrega", base);
    if (adopted) this.delivery = Promise.resolve(adopted);
  }

  /** The sealed tests kept for this route by an earlier run of the climb, or null when there are none. */
  async restoreSeal(route: PlannedRoute): Promise<SealedTests | null> {
    const dir = this.sealDir(route);
    const manifest = readText(join(dir, SEAL_MANIFEST));
    if (!manifest) return null;
    const declared = JSON.parse(manifest) as { path: string; kind: SealedFile["kind"] }[];
    const files = declared.flatMap(({ path, kind }) => {
      const content = readText(join(dir, path));
      return content === null ? [] : [{ path, kind, content }];
    });
    const sealed = { files, unit: files.filter((f) => f.kind === "unit").length, e2e: files.filter((f) => f.kind === "e2e").length };
    this.sealed.set(route.id, sealed);
    return sealed;
  }

  private openWorktrees(): Promise<Worktrees> {
    const { config, worktreesDir } = this.options;
    this.worktrees ??= Worktrees.open(config.projectRoot, {
      baseDir: worktreesDir ?? join(defaultUserDir(), "worktrees"),
      mohsDir: config.mohsDir,
    });
    return this.worktrees;
  }
}

function write(root: string, file: SealedFile): void {
  const path = join(root, file.path);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, file.content);
}
