import { classifyFindings } from "../brake/findings.ts";
import { checksAt, runChecks } from "../checks/run.ts";
import type { RackItem } from "../config/types.ts";
import {
  CrewError,
  NotYetSupported,
  type AnchorResult,
  sealedCode,
  type AnchorVerify,
  type ClimbNotes,
  type Dispute,
  type CrewObserver,
  type FallReport,
  type FixResult,
  type PitchContext,
  type PitchResult,
  type RouteWorkspace,
  type SendFailure,
} from "../crew/types.ts";
import type { EventPayloads, EventType } from "../domain/events.ts";
import { isRigged, type PlannedPitch, type PlannedRoute } from "../domain/plan.ts";
import type { ClassifiedFinding, FixReason, FrictionKind, Hardness } from "../domain/types.ts";
import { gradeEvidence, type Evidence } from "../domain/evidence.ts";
import type { CheckDefinition } from "../index.ts";
import { buildPack, summarizePack, type Pack } from "../pack/build.ts";
import { diffStats } from "../pack/review-diff.ts";
import { findLeaks } from "../guards/leak.ts";
import { selectInspectors } from "../rack/select.ts";
import { matchGlob } from "../util/glob.ts";
import { isTestPath } from "../util/paths.ts";
import { explainFall } from "./fall.ts";
import type { RouteProgress } from "./resume.ts";
import { ClimbAborted, ClimbEscalated, type ClimbSession } from "./session.ts";

const MAX_ANCHOR_ATTEMPTS = 3;

/**
 * Summits a human signs. Diamond, because it is sensitive; talc, because nobody signed a line before the work: the
 * human reads the diff and the climber's decisions together, once, at the end.
 */
const SIGNED_SUMMIT: ReadonlySet<Hardness> = new Set(["talc", "diamond"]);

/** Control-flow signal: a human abandoned this route. Only this route stops; the climb goes on. */
class RouteAbandoned extends Error {}

/**
 * Takes one route from its workspace to the summit:
 * pitches with anchors → send with falls → parallel inspection → summit.
 */
export class RouteClimber {
  private readonly session: ClimbSession;
  private readonly route: PlannedRoute;
  private readonly startedAt = Date.now();
  private workspace: RouteWorkspace = { path: "" };
  private sendAttempts = 0;
  /** Files the route's commits changed, and the project checks that ran on them: what the summit's evidence rests on. */
  private readonly touched = new Set<string>();
  private readonly checksRan = new Set<string>();
  private decisions: string[] = [];
  private disputes = 0;
  private lastFailures: SendFailure[] = [];

  /** Where an earlier run of the climb left this route: the climb goes on from the first pitch without an anchor. */
  private readonly fromPitch: number;

  constructor(session: ClimbSession, route: PlannedRoute, progress?: RouteProgress) {
    this.session = session;
    this.route = route;
    const done = progress?.anchored ?? new Set<number>();
    this.fromPitch = route.pitches.findIndex((_, i) => !done.has(i + 1)) + 1 || route.pitches.length + 1;
    for (const file of progress?.touched ?? []) this.touched.add(file);
    this.decisions = progress?.decisions ?? [];
  }

  /** Returns true when the route reached the summit, false when a human abandoned it. */
  async climb(): Promise<boolean> {
    this.workspace = await this.session.runner.prepare(this.route);
    this.record("route.started", { workspace: this.workspace.path, branch: this.workspace.branch });
    try {
      for (let n = this.fromPitch; n <= this.route.pitches.length; n++) await this.climbPitch(n);
      if (this.route.hardness === "talc") await this.checkTalcBounds();
      if (isRigged(this.route)) await this.sendUntilClean();
      await this.inspect();
      if (SIGNED_SUMMIT.has(this.route.hardness)) await this.signSummit();
      const delivery = await this.session.runner.finish(this.route, "summit");
      this.record("route.summit", { ms: Date.now() - this.startedAt, ...delivery, evidence: this.evidence() });
      return true;
    } catch (error) {
      // Abandonar encerra só esta route; qualquer outro erro sobe depois de liberar o workspace.
      await this.session.runner.finish(this.route, "abandoned").catch(() => undefined);
      if (!(error instanceof RouteAbandoned)) throw error;
      return false;
    }
  }

  // ── pitches ────────────────────────────────────────────────────────────

  private async climbPitch(n: number): Promise<void> {
    const pitch = this.route.pitches[n - 1];
    const pack = this.packFor(pitch, n);
    const { settings } = this.session.config;

    this.record(
      "pitch.started",
      {
        title: pitch.title,
        crux: !!pitch.crux,
        model: pitch.crux ? settings.models.crux : settings.models.climber,
        pack: summarizePack(pack),
      },
      n,
    );
    if (pack.overflow.length) this.friction("pack.overflow", `skills fora do pack por falta de O₂: ${pack.overflow.join(", ")}`, n);
    this.session.journal.call({
      call: "CLIMB",
      from: "basecamp",
      to: this.climber,
      route: this.route.id,
      pitch: n,
      pack: { tokens: pack.tokens, skills: pack.skills, beta: pack.beta },
    });

    let feedback: string | undefined;
    for (let attempt = 1; ; attempt++) {
      if (attempt > 1) this.record("pitch.retry", { attempt }, n);
      const result = await this.guarded(n, () =>
        this.session.crew.climbPitch(this.route, n, this.pitchContext(pack, n, attempt, feedback)),
      );
      if (typeof result === "string") {
        feedback = result;
        continue;
      }
      const retryBecause = await this.settle(result, n);
      if (retryBecause) {
        feedback = retryBecause;
        continue;
      }

      const anchor = await this.anchor(n, attempt);
      if (anchor.ok) return;
      feedback = `As checagens da anchor falharam. Corrija antes de chamar safe de novo.\n\n${anchor.output ?? ""}`;
      if (attempt >= MAX_ANCHOR_ATTEMPTS) await this.rescueOrAbandon(`a anchor do pitch ${n} falhou ${attempt} vezes`, "anchor");
    }
  }

  /**
   * Records how the pitch ended. Returns feedback for another attempt when the climber stopped on a
   * doubt (WATCH) or a broken environment (ROCK) and a human chose to go on; undefined when it is SAFE.
   */
  private async settle(result: PitchResult, n: number): Promise<string | undefined> {
    const { journal, gate } = this.session;
    for (const { kind, detail } of result.friction ?? []) this.friction(kind, detail, n);

    switch (result.outcome) {
      case "safe":
        if (result.rock) this.reportRock(result.rock, n);
        if (result.note) this.friction("crew.note", result.note, n);
        if (result.decisions?.length) {
          this.decisions = result.decisions;
          this.record("decisions.taken", { decisions: result.decisions }, n);
        }
        journal.call(
          { call: "SAFE", from: this.climber, to: "basecamp", route: this.route.id, pitch: n, summary: result.summary.slice(0, 280) },
          { o2: result.o2 },
        );
        this.session.checkO2();
        return undefined;

      case "watch": {
        journal.call(
          { call: "WATCH", from: this.climber, to: "basecamp", route: this.route.id, excerpt: result.excerpt, question: result.question },
          { o2: result.o2 },
        );
        this.friction("spec.ambiguity", result.question, n);
        const choice = await gate.rescue(
          `route ${this.route.id}: a line está ambígua. ${result.question}`,
          ["proceed", "abandon"],
          this.route.id,
        );
        if (choice === "abandon") this.abandon("line ambígua");
        return `Um humano leu sua dúvida ("${result.question}") e mandou seguir com a line como está.`;
      }

      case "escalate":
        throw new ClimbEscalated(result.reason, "climber");

      case "rock":
        this.reportRock(result, n, result.o2);
        await this.rescueOrAbandon(`ambiente quebrado: ${result.command}: ${result.error}`, "ambiente");
        return `Um humano pediu nova tentativa depois do problema de ambiente (${result.command}: ${result.error}).`;
    }
  }

  private reportRock(rock: { command: string; error: string }, n: number, o2?: number): void {
    this.session.journal.call(
      { call: "ROCK", from: this.climber, to: "basecamp", command: rock.command, error: rock.error },
      { route: this.route.id, o2 },
    );
    this.friction("env", `${rock.command}: ${rock.error}`, n);
  }

  /** The harness runs the anchor checks itself; the climber never gets to say they passed. */
  private async anchor(n: number, attempt: number, fix?: FixReason): Promise<AnchorResult> {
    const files = fix ? this.route.files : this.route.pitches[n - 1].files;
    const checks = checksAt(this.session.checks, "anchor", this.route, files);
    for (const check of checks) this.checksRan.add(check.name);
    const verify: AnchorVerify | undefined = checks.length
      ? async (exec) => {
          const failures = await runChecks(checks, this.route, files, exec);
          return failures.length ? failures.map((f) => `check ${f.name} falhou: ${f.message}`).join("\n") : null;
        }
      : undefined;
    const result = await this.session.runner.anchor(this.route, n, attempt, this.session.config.settings.commands.anchor, verify);
    if (!result.ok) {
      this.friction("anchor.failed", result.output ?? "checagem da anchor falhou", n);
      return result;
    }
    this.record("pitch.anchor", { commit: result.commit, checks: result.checks, fix, files: result.files }, n);
    for (const file of result.files ?? []) this.touched.add(file);
    this.checkScope(result.files ?? [], n, fix);
    return result;
  }

  /**
   * Changing files the scout did not plan is allowed, but it shows up as friction. Read from the
   * commit, so it holds for any crew, whether or not its tools are watched.
   */
  private checkScope(files: readonly string[], n: number, fix?: FixReason): void {
    // Sem arquivos planejados (talc) não há escopo a comparar: os limites do talc cuidam do tamanho.
    if (!this.route.pitches[n - 1]?.files.length && !fix) return;
    const planned = new Set(fix ? [...this.route.files, ...this.route.pitches.flatMap((p) => p.files)] : this.route.pitches[n - 1].files);
    const outside = files.filter((file) => !planned.has(file));
    if (outside.length) this.friction("scope.drift", `alterou fora dos arquivos do pitch: ${outside.join(", ")}`, n);
  }

  private packFor(pitch: PlannedPitch, n: number): Pack {
    const { config, view, survey } = this.session;
    return buildPack(config, {
      role: "climber",
      hardness: this.route.hardness,
      files: pitch.files,
      tags: this.route.tags,
      survey: survey.summary,
      line: view.line?.text,
      bolts: isRigged(this.route) ? this.session.notes(this.route.id).bolts : undefined,
      task:
        this.route.hardness === "talc"
          ? `Correção pequena (talc), sem plano nem line: você decide os arquivos.\n\nPedido: ${this.session.request}`
          : `Pitch ${n} de ${this.route.pitches.length} da route ${this.route.id} (${this.route.name}): ${pitch.title}\nArquivos previstos: ${pitch.files.join(", ")}`,
    });
  }

  private pitchContext(pack: Pack, n: number, attempt: number, feedback?: string): PitchContext {
    return { pack, attempt, feedback, workspace: this.workspace, observer: this.session.observerFor({ route: this.route.id, pitch: n }) };
  }

  /**
   * Runs crew work. When the agent hits a limit, is refused or its provider fails, the failure
   * becomes friction and a rescue; returns feedback for the next attempt instead of a result.
   */
  private async guarded<T>(n: number, work: () => Promise<T>): Promise<T | string> {
    try {
      return await work();
    } catch (error) {
      if (error instanceof NotYetSupported) throw new ClimbAborted(error.message, "basecamp");
      if (!(error instanceof CrewError)) throw error;
      this.friction(error.kind, error.message, n, error.o2);
      await this.rescueOrAbandon(`o agente parou: ${error.message}`, error.kind);
      return `A tentativa anterior foi interrompida (${error.message}). Seja mais direto: leia só o necessário e conclua.`;
    }
  }

  // ── send ───────────────────────────────────────────────────────────────

  private async sendUntilClean(): Promise<void> {
    let consecutiveFalls = 0;
    for (;;) {
      const fall = await this.send();
      if (!fall) return;
      if (++consecutiveFalls >= this.session.config.brake.fallsBeforeRescue) {
        await this.rescueOrAbandon(`${consecutiveFalls} falls seguidas no send`, "falls");
        consecutiveFalls = 0;
      }
      // O climber recebe a FALL do belayer, já passada pelo leak guard; nunca a saída crua dos testes selados.
      await this.recoverFromFall(fall);
    }
  }

  /**
   * The climber fixes the code, or contests the test with the line. A contested test is judged by the belayer; a test
   * it corrects goes back to the send, one it upholds comes back to the climber with the reason.
   */
  private async recoverFromFall(fall: FallReport): Promise<void> {
    const details = [`${fall.scenario}: esperado ${fall.expected}, obtido ${fall.actual}`];
    for (;;) {
      const result = await this.fix("fall", details);
      if (result.outcome === "safe") return;
      const verdict = await this.judge(result, fall);
      if (verdict === "amended") return;
      details.push(`Sua contestação não mudou o teste: ${verdict.reason}`);
    }
  }

  /**
   * The first dispute goes to the belayer. If the climber disputes again, a human decides: keep the test (retry) or
   * side with the climber (proceed), and then the belayer must correct it. Test changes happen only through here.
   */
  private async judge(dispute: Dispute, fall: FallReport): Promise<{ reason: string } | "amended"> {
    const { session, route } = this;
    let mustAmend = false;
    if (++this.disputes > 1) {
      const choice = await session.gate.rescue(
        `route ${route.id}: o climber contesta de novo o teste selado ("${dispute.excerpt}": ${dispute.argument}). retry mantém o teste; proceed dá razão ao climber e o belayer corrige o teste`,
        ["retry", "proceed"],
        route.id,
      );
      if (choice !== "proceed") {
        const reason = "um humano leu a contestação e manteve o teste; siga a FALL";
        this.record("seal.upheld", { reason }, undefined, "human");
        return { reason };
      }
      mustAmend = true;
    }
    const sealed = session.sealed.get(route.id) ?? { files: [], unit: 0, e2e: 0 };
    const workspace = await session.runner.prepareSeal(route);
    const verdict = await this.retrying(() =>
      session.crew.judgeDispute(route, {
        notes: this.notes(),
        sealed,
        failures: this.lastFailures,
        fall,
        dispute,
        workspace,
        mustAmend,
        observer: this.observer(),
      }),
    );
    if (verdict.verdict === "uphold") {
      const leaked = findLeaks(verdict.reason, session.sealedCode.get(route.id) ?? "");
      if (leaked.length) this.friction("leak.blocked", `a resposta à contestação copiava trechos do seal (${leaked.length}); foi redigida`);
      const reason = leaked.length ? "o belayer conferiu o teste contra a line e o manteve" : verdict.reason;
      this.record("seal.upheld", { reason }, undefined, `belayer ${route.id}`, verdict.o2);
      return { reason };
    }
    session.sealed.set(route.id, verdict.sealed);
    session.sealedCode.set(route.id, sealedCode(verdict.sealed));
    const red = await session.runner.sealRed(route, verdict.sealed);
    this.record(
      "seal.amended",
      { reason: verdict.reason, unit: verdict.sealed.unit, e2e: verdict.sealed.e2e },
      undefined,
      `belayer ${route.id}`,
      verdict.o2,
    );
    if (!red.allRed) this.friction("seal.green", `o teste corrigido já passa no código de antes da route: ${red.passing.join(", ")}`);
    return "amended";
  }

  /** Runs the sealed tests away from the climber's worktree. Returns the belayer's FALL, or null when clean. */
  private async send(): Promise<FallReport | null> {
    const attempt = ++this.sendAttempts;
    const fullSuite = this.route.hardness === "diamond";
    this.record("send.started", { attempt, fullSuite });
    const result = await this.session.runner.send(this.route, attempt, fullSuite ? this.session.config.settings.commands.send : []);
    if (result.ok) {
      this.record("send.clean", { attempt, total: result.total });
      return null;
    }
    this.record("send.fall", { attempt, failed: result.failures.length, total: result.total });
    this.lastFailures = result.failures;
    this.friction("send.fall", `${result.failures.length} de ${result.total} testes selados falharam`);
    return this.reportFall(result.failures);
  }

  /** The belayer's explanation of the failures, sent to the climber as a FALL call. */
  private async reportFall(failures: SendFailure[]): Promise<FallReport> {
    const report = await explainFall(this.session, this.route, failures, (work) => this.retrying(work));
    this.session.journal.call(
      {
        call: "FALL",
        from: `belayer ${this.route.id}`,
        to: this.climber,
        route: this.route.id,
        scenario: report.scenario,
        expected: report.expected,
        actual: report.actual,
      },
      { o2: report.o2 },
    );
    return report;
  }

  /** A climber fix in the route's worktree, anchored like a pitch; or, after a FALL, the climber's dispute. */
  private async fix(reason: FixReason, details: string[]): Promise<FixResult> {
    const top = this.route.pitches.length;
    this.record("fix.started", { reason, details }, top);
    const context = this.pitchContext(this.packFor(this.route.pitches[top - 1], top), top, 1);
    const raw = await this.guarded(top, () => this.session.crew.fix(this.route, reason, details, context));
    const result: FixResult = typeof raw === "string" ? { o2: 0, outcome: "safe", summary: raw } : raw;
    if (result.outcome === "dispute") {
      this.record("seal.disputed", { excerpt: result.excerpt, argument: result.argument }, top, this.climber, result.o2);
      this.friction("seal.disputed", `o climber contesta o teste com a line: ${result.argument}`, top);
      return result;
    }
    this.session.journal.call(
      { call: "SAFE", from: this.climber, to: "basecamp", route: this.route.id, pitch: top, summary: result.summary.slice(0, 280) },
      { o2: result.o2 },
    );
    this.session.checkO2();
    await this.anchor(top, 1, reason);
    return result;
  }

  // ── inspection ─────────────────────────────────────────────────────────

  /**
   * Inspectors (quartz and diamond) and the project's send and summit checks, for every hardness. Blocking findings
   * go back to the climber; a rigged route is sent again after each fix.
   */
  private async inspect(): Promise<void> {
    const { config } = this.session;
    const inspectors = selectInspectors(config, this.route.hardness, this.route.files);
    const checks = [
      ...(isRigged(this.route) ? checksAt(this.session.checks, "send", this.route, this.route.files) : []),
      ...checksAt(this.session.checks, "summit", this.route, this.route.files),
    ];
    for (const check of checks) this.checksRan.add(check.name);
    if (!inspectors.length && !checks.length) return;

    for (let round = 1; ; round++) {
      const names = [...inspectors.map((inspector) => inspector.name), ...(checks.length ? ["checks"] : [])];
      this.record("inspection.started", { inspectors: names, round });
      const blocking = [...(await this.inspectionRound(inspectors, round)), ...(await this.checkRound(checks, round))];
      if (!blocking.length) {
        if (round > 1) this.record("findings.resolved", { round });
        return;
      }
      this.record("inspection.blocked", { count: blocking.length, round });
      this.friction("inspection.blocked", `${blocking.length} achado(s) bloqueante(s): ${blocking.map((f) => f.text).join("; ")}`);
      if (round >= config.brake.inspectionRounds)
        await this.rescueOrAbandon(`achados bloqueantes depois de ${round} rodadas`, "inspection");

      await this.fix(
        "inspection",
        blocking.map((f) => `${f.severity} · ${f.inspector}: ${f.text}`),
      );
      // Toda correção de inspection reabre o send: os testes selados rodam de novo.
      if (isRigged(this.route)) await this.sendUntilClean();
    }
  }

  /** The project's checks as a deterministic inspector: each failure is a finding with full confidence. */
  private async checkRound(checks: readonly CheckDefinition[], round: number): Promise<ClassifiedFinding[]> {
    if (!checks.length) return [];
    const failures = await runChecks(checks, this.route, this.route.files, (command) => this.session.runner.exec(this.route, command));
    const findings = classifyFindings(
      failures.map((f) => ({ inspector: `check:${f.name}`, severity: f.severity, area: "check", text: f.message, confidence: 100 })),
      this.session.config.brake,
    );
    this.session.journal.record("inspection.report", { inspector: "checks", round, findings }, { actor: "basecamp", route: this.route.id });
    return findings.filter((f) => f.action === "block");
  }

  /** Every inspector is dispatched before any result is read, so no report can influence another. */
  private async inspectionRound(inspectors: RackItem[], round: number): Promise<ClassifiedFinding[]> {
    if (!inspectors.length) return [];
    const { crew, config, runner } = this.session;
    const context = { notes: this.notes(), workspace: this.workspace, diff: await runner.diff(this.route), observer: this.observer() };
    const reports = await Promise.all(
      inspectors.map(async (inspector) => ({
        inspector,
        report: await this.retrying(() => crew.inspect(this.route, inspector, round, context)),
      })),
    );

    const blocking: ClassifiedFinding[] = [];
    for (const { inspector, report } of reports) {
      const findings = classifyFindings(
        report.findings.map((f) => ({ ...f, inspector: inspector.name })),
        config.brake,
      );
      blocking.push(...findings.filter((f) => f.action === "block"));
      this.session.journal.record(
        "inspection.report",
        { inspector: inspector.name, round, findings },
        { actor: `inspector ${inspector.name}`, route: this.route.id, o2: report.o2 },
      );
    }
    this.session.checkO2();
    return blocking;
  }

  /** A signed summit waits for a human, bound to the route's last commit; in talc, with the climber's decisions. */
  private async signSummit(): Promise<void> {
    const head = await this.session.runner.head(this.route);
    const branch = this.workspace.branch;
    const decisions = this.decisions.length
      ? `\n\nDecisões que o climber tomou sozinho:\n${this.decisions.map((decision) => `- ${decision}`).join("\n")}`
      : "";
    await this.session.gate.awaitSignature({
      target: `summit-${this.route.id}`,
      what: this.route.hardness === "talc" ? `A correção e as decisões do climber` : `A entrega da route ${this.route.id}`,
      review: branch ? `a branch ${branch} (git diff HEAD...${branch})` : "o resultado no Lookout",
      text: `route ${this.route.id} · ${this.route.name}\ncommit ${head.slice(0, 12)}${branch ? `\nbranch ${branch}` : ""}${decisions}`,
      route: this.route.id,
      current: () => head,
    });
  }

  /**
   * A talc fix must stay small and away from sensitive code, whatever the climber thought. Checked on what the
   * commits changed (tests do not count): past the bounds, the climb asks for the full flow.
   */
  private async checkTalcBounds(): Promise<void> {
    const { settings, croqui } = this.session.config;
    const { maxFiles, maxLines } = settings.talc;
    const sensitive = [...settings.talc.sensitive, ...(croqui?.sensitive.map((area) => area.glob) ?? [])];
    const code = diffStats(await this.session.runner.diff(this.route)).filter((file) => !isTestPath(file.path));
    const touchy = code.find((file) => sensitive.some((glob) => matchGlob(file.path, glob)));
    const lines = code.reduce((sum, file) => sum + file.added + file.removed, 0);
    const reason = touchy
      ? `a correção mexeu em ${touchy.path}, que é área sensível`
      : code.length > maxFiles
        ? `a correção mudou ${code.length} arquivos de código (o talc vai até ${maxFiles})`
        : lines > maxLines
          ? `a correção mudou ${lines} linhas de código (o talc vai até ${maxLines})`
          : undefined;
    if (reason) throw new ClimbEscalated(reason, "basecamp");
  }

  /** What proved the route: sealed tests, the project's tests (when it has any), other commands and checks. */
  private evidence(): Evidence {
    const { config, survey, sealed } = this.session;
    const seal = isRigged(this.route) ? sealed.get(this.route.id) : undefined;
    const suite = this.route.hardness === "diamond" ? config.settings.commands.send : [];
    const added = [...this.touched].filter(isTestPath).length;
    return gradeEvidence({
      sealed: seal ? seal.unit + seal.e2e : 0,
      commands: [...new Set([...config.settings.commands.anchor, ...suite])],
      projectTests: (survey.tests ?? 0) + added,
      checks: this.checksRan.size,
    });
  }

  // ── helpers ────────────────────────────────────────────────────────────

  private get climber(): string {
    return `climber ${this.route.id}`;
  }

  /** Crew work with no pitch to retry: a failure becomes friction and a rescue, then the same work runs again. */
  private async retrying<T>(work: () => Promise<T>): Promise<T> {
    for (;;) {
      const result = await this.guarded(this.route.pitches.length, work);
      if (typeof result !== "string") return result;
    }
  }

  private notes(): ClimbNotes {
    return this.session.notes(this.route.id);
  }

  private observer(pitch?: number): CrewObserver {
    return this.session.observerFor({ route: this.route.id, pitch });
  }

  private async rescueOrAbandon(reason: string, abandonReason: string): Promise<void> {
    const choice = await this.session.gate.rescue(`route ${this.route.id}: ${reason}`, ["retry", "abandon"], this.route.id);
    if (choice === "abandon") this.abandon(abandonReason);
  }

  private abandon(reason: string): never {
    this.record("route.abandoned", { reason }, undefined, "human");
    throw new RouteAbandoned(reason);
  }

  private record<K extends EventType>(type: K, data: EventPayloads[K], pitch?: number, actor = "basecamp", o2?: number): void {
    this.session.journal.record(type, data, { actor, route: this.route.id, pitch, o2 });
  }

  private friction(kind: FrictionKind, detail: string, pitch?: number, o2?: number): void {
    this.session.journal.friction(kind, detail, { route: this.route.id, pitch, o2 });
  }
}
