import { CrewError, type SendFailure } from "../crew/types.ts";
import { isRigged, type PlannedRoute } from "../domain/plan.ts";
import type { RescueOption } from "../domain/types.ts";
import { maxHardness } from "../domain/types.ts";
import { buildPack } from "../pack/build.ts";
import { explainFall } from "./fall.ts";
import { ClimbAborted, type ClimbSession } from "./session.ts";

const MAX_FIX_ATTEMPTS = 3;
/** The delivery shows up in tasks as this route, so agents and the Lookout can name it. */
const DELIVERY = "entrega";
/** Only the end of a failing command reaches the climber: the assertion is almost always there. */
const OUTPUT_TAIL = 2_000;

/**
 * Joins the climb's routes into one delivery branch and proves they work together. Routes merge as they reach
 * the summit, so later windows start from them; at the end every route's sealed tests, the anchor and the full
 * suite run on the delivery. A conflict or a failure becomes a climber task in the delivery worktree.
 */
export class Integration {
  private readonly session: ClimbSession;
  private readonly merged: PlannedRoute[] = [];

  constructor(session: ClimbSession) {
    this.session = session;
  }

  get routes(): readonly PlannedRoute[] {
    return this.merged;
  }

  /** A route an earlier run of this climb already merged: counted in the delivery, not merged again. */
  restore(route: PlannedRoute): void {
    this.merged.push(route);
  }

  async merge(route: PlannedRoute): Promise<void> {
    const result = await this.session.runner.integrate(route);
    let commit = result.ok ? result.commit : undefined;
    if (!result.ok) {
      const files = result.conflicts.join(", ") || "arquivos não identificados";
      this.session.journal.record("integration.conflict", { files: result.conflicts }, { actor: "basecamp", route: route.id });
      this.session.journal.friction("integration.conflict", `a route ${route.id} conflita com a entrega em ${files}`, { route: route.id });
      commit = await this.fix(
        [
          `O merge da route ${route.id} (${route.name}) na entrega deu conflito em: ${files}.`,
          "Resolva os marcadores de conflito mantendo o que as duas routes fazem. Não faça commit: o Basecamp conclui o merge.",
        ],
        `mohs: integra a route ${route.id} (${route.name})`,
      );
    }
    this.session.journal.record("integration.merged", { commit }, { actor: "basecamp", route: route.id });
    this.merged.push(route);
  }

  /** Runs everything on the delivery until it is clean, sending failures back to a climber. */
  async check(): Promise<void> {
    const { runner, config, journal } = this.session;
    const commands = [...config.settings.commands.anchor, ...config.settings.commands.send];
    let falls = 0;
    for (let attempt = 1; ; attempt++) {
      journal.record("integration.started", { attempt }, { actor: "basecamp" });
      const result = await runner.sendDelivery(attempt, commands);
      if (result.ok) {
        journal.record("integration.clean", { attempt, total: result.total }, { actor: "basecamp" });
        return;
      }
      journal.record("integration.fall", { attempt, failed: result.failures.length, total: result.total }, { actor: "basecamp" });
      journal.friction("integration.fall", `${result.failures.length} de ${result.total} checagens falharam na entrega`);
      if (++falls >= config.brake.fallsBeforeRescue) {
        await this.rescue(`${falls} falhas seguidas na entrega`);
        falls = 0;
      }
      await this.fix(await this.explain(result.failures), `mohs: corrige a entrega (tentativa ${attempt})`);
    }
  }

  async finish(): Promise<void> {
    const delivery = await this.session.runner.finishDelivery();
    this.session.journal.record("integration.done", { ...delivery, routes: this.merged.map((route) => route.id) }, { actor: "basecamp" });
  }

  /**
   * Sealed failures go through the belayer of their route (FALL, leak guard); the climber never reads the tests.
   * A failing anchor or suite command is visible code, so its output goes as it is.
   */
  private async explain(failures: readonly SendFailure[]): Promise<string[]> {
    const details: string[] = [];
    const sealed = Map.groupBy(
      failures.filter((failure) => failure.route),
      (failure) => failure.route!,
    );
    for (const [routeId, list] of sealed) {
      const route = this.session.plan.routes.find((r) => r.id === routeId);
      if (!route) continue;
      const fall = await explainFall(this.session, route, list, (work) => this.retrying(work));
      this.session.journal.call(
        {
          call: "FALL",
          from: `belayer ${routeId}`,
          to: `climber ${DELIVERY}`,
          route: routeId,
          scenario: fall.scenario,
          expected: fall.expected,
          actual: fall.actual,
        },
        { o2: fall.o2 },
      );
      details.push(`route ${routeId} · ${fall.scenario}: esperado ${fall.expected}, obtido ${fall.actual}`);
    }
    for (const failure of failures.filter((f) => !f.route)) details.push(`${failure.test} falhou:\n${failure.output.slice(-OUTPUT_TAIL)}`);
    return details;
  }

  /** A climber fixes the delivery; the Basecamp runs the anchor and commits. Returns the commit. */
  private async fix(details: string[], message: string): Promise<string | undefined> {
    const { crew, runner, config, journal } = this.session;
    const workspace = await runner.deliveryWorkspace();
    const route = this.deliveryRoute();
    let feedback: string | undefined;
    for (let attempt = 1; ; attempt++) {
      const context = { pack: this.pack(route), attempt, workspace, feedback, observer: this.session.observerFor({ route: DELIVERY }) };
      const result = await this.retrying(() => crew.fix(route, "integration", details, context));
      // Na entrega não há FALL de um só belayer para contestar: a correção termina sempre em safe.
      const summary = result.outcome === "safe" ? result.summary : `contestação: ${result.argument}`;
      journal.call(
        { call: "SAFE", from: `climber ${DELIVERY}`, to: "basecamp", route: DELIVERY, pitch: 1, summary: summary.slice(0, 280) },
        { o2: result.o2 },
      );
      const anchor = await runner.anchorDelivery(attempt, config.settings.commands.anchor, message);
      if (anchor.ok) {
        journal.record("integration.fixed", { commit: anchor.commit, checks: anchor.checks }, { actor: "basecamp" });
        return anchor.commit;
      }
      journal.friction("anchor.failed", anchor.output ?? "checagem da anchor falhou na entrega", { route: DELIVERY });
      feedback = `As checagens da anchor falharam na entrega. Corrija antes de chamar safe de novo.\n\n${anchor.output ?? ""}`;
      if (attempt >= MAX_FIX_ATTEMPTS) await this.rescue(`a correção da entrega falhou ${attempt} vezes`);
    }
  }

  /** The delivery as a route: every route's files, the climb's hardness. */
  private deliveryRoute(): PlannedRoute {
    const routes = this.session.plan.routes;
    const files = [...new Set(routes.flatMap((route) => route.files))];
    return {
      id: DELIVERY,
      name: `Entrega do climb (${routes.map((route) => route.id).join(" + ")})`,
      hardness: maxHardness(routes.map((route) => route.hardness)),
      files,
      tags: [],
      pitches: [{ title: "Integração das routes", files }],
    };
  }

  private pack(route: PlannedRoute) {
    const { config, survey, view } = this.session;
    const bolts = this.session.plan.routes
      .filter(isRigged)
      .flatMap((r) => {
        const text = this.session.notes(r.id).bolts;
        return text ? [`### Route ${r.id}\n\n${text}`] : [];
      })
      .join("\n\n");
    return buildPack(config, {
      role: "climber",
      hardness: route.hardness,
      files: route.files,
      tags: [],
      survey: survey.summary,
      line: view.line?.text,
      bolts: bolts || undefined,
      task: `Entrega do climb: as routes ${this.session.plan.routes.map((r) => r.id).join(", ")} juntas numa branch. Trabalhe no diretório da tarefa, que é o worktree da entrega.`,
    });
  }

  private async retrying<T>(work: () => Promise<T>): Promise<T> {
    for (;;) {
      try {
        return await work();
      } catch (error) {
        if (!(error instanceof CrewError)) throw error;
        this.session.journal.friction(error.kind, error.message, { route: DELIVERY, o2: error.o2 });
        await this.rescue(`o agente parou na entrega: ${error.message}`);
      }
    }
  }

  private async rescue(reason: string): Promise<void> {
    const options: RescueOption[] = ["retry", "abort"];
    const choice = await this.session.gate.rescue(`entrega: ${reason}`, options);
    if (choice === "abort") throw new ClimbAborted(`entrega interrompida: ${reason}`);
  }
}
