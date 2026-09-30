import { isRigged, type PlannedRoute } from "../domain/plan.ts";
import { Integration } from "./integration.ts";
import { sealedCode, type RouteWorkspace } from "../crew/types.ts";
import { sealRoute, setBolts, signBolts } from "./rigging.ts";
import { RouteClimber } from "./route-climber.ts";
import type { ClimbSession } from "./session.ts";
import { blockersOf, planWindows } from "./windows.ts";

/**
 * Takes every route up, each one as soon as it can. A route above fluorite gets its bolts first; its seal waits for the
 * bolts of the routes it depends on, which its tests use. Then the route waits only for the routes it must start from,
 * until they join the delivery. Nothing waits for an unrelated route's rigging: a fluorite route climbs while the
 * belayers of the others are still writing tests.
 *
 * The seal is written while the climber climbs: the climber never sees it and it only runs in the send, so the send
 * is the only thing that waits for it. Solo, the tests come first (TDD): the climber reads them, so the climb waits.
 */
export class Ascent {
  private readonly session: ClimbSession;
  private readonly windows: PlannedRoute[][];
  private readonly integration?: Integration;
  /** Per route: its bolts are set (and signed, in diamond). */
  private readonly bolted = new Map<string, Promise<void>>();
  /** Per route: it is in the delivery, or it will never be (abandoned). */
  private readonly settled = new Map<string, Promise<void>>();
  private readonly finished = new Set<string>();
  /** One merge at a time: the delivery grows in the order routes reach the summit. */
  private merges: Promise<unknown> = Promise.resolve();
  /** A seal that stops the climb (a human chose abort) stops it at once, not when its route reaches the send. */
  private stop: (error: unknown) => void = () => undefined;

  constructor(session: ClimbSession) {
    this.session = session;
    this.windows = planWindows(session.plan.routes);
    this.integration = session.plan.routes.length > 1 ? new Integration(session) : undefined;
    session.integration = this.integration;
  }

  async run(): Promise<void> {
    const { session } = this;
    const routes = this.windows.flat();
    // Retomado depois do plano da subida, a ordem já está no log (e o climb pode já estar na entrega).
    if (!session.view.windows.length) {
      session.journal.record("ascent.planned", { windows: this.windows.map((w) => w.map((route) => route.id)) }, { actor: "basecamp" });
    }
    if (session.resume) await session.runner.resumeDelivery?.();
    for (const route of routes) this.bolted.set(route.id, handled(this.rig(route)));
    // Em ordem de dependência: quem uma route espera já tem a sua promessa quando ela é criada.
    const climbs = routes.map((route) => {
      const climb = this.climb(route).then(() => void this.finished.add(route.id));
      this.settled.set(route.id, handled(climb));
      return climb;
    });
    const stopped = new Promise<never>((_, reject) => (this.stop = reject));
    await Promise.race([Promise.all(climbs), stopped]);
  }

  /** The bolts of a route above fluorite; a resumed climb keeps those already set, and only waits for the signature. */
  private async rig(route: PlannedRoute): Promise<void> {
    // Solo, os bolts seriam um contrato do agente com ele mesmo: só o diamond os mantém, porque o humano os assina.
    if (!isRigged(route) || (this.session.solo && route.hardness !== "diamond")) return;
    const progress = this.session.resume?.routes.get(route.id);
    if (!progress?.bolted) return setBolts(this.session, route);
    if (route.hardness === "diamond" && !progress.boltsSigned) await signBolts(this.session, route);
  }

  private async climb(route: PlannedRoute): Promise<void> {
    const progress = this.session.resume?.routes.get(route.id);
    if (progress?.summited) {
      if (progress.merged) this.integration?.restore(route);
      else if (this.integration) await this.merge(route);
      return;
    }
    const blockers = blockersOf(route, this.windows);
    let seal: PendingSeal | undefined;
    let workspace: Promise<RouteWorkspace> | undefined;
    if (isRigged(route)) {
      const dependencies = (route.after ?? []).flatMap((id) => this.bolted.get(id) ?? []);
      await Promise.all([this.bolted.get(route.id), ...dependencies]);
      const restored = progress?.sealed && (await this.restoreSeal(route));
      if (this.session.solo) {
        if (!restored) await sealRoute(this.session, route);
      } else if (!restored) {
        // Uma route que já pode subir prepara o worktree do climber antes: a tarefa dele abre logo depois da do belayer.
        if (blockers.every((id) => this.finished.has(id))) workspace = handled(this.session.runner.prepare(route));
        let belaying!: () => void;
        const opened = new Promise<void>((resolve) => (belaying = resolve));
        seal = inProgress(sealRoute(this.session, route, { after: workspace, belaying }), this.stop);
        await Promise.race([opened, seal.ready.catch(() => undefined)]);
      }
    }
    const pending = blockers.filter((id) => !this.finished.has(id));
    if (pending.length) {
      this.session.journal.record("route.waiting", { for: pending }, { actor: "basecamp", route: route.id });
      await Promise.all(blockers.map((id) => this.settled.get(id)));
    }
    const summited = await new RouteClimber(this.session, route, { progress, seal, workspace }).climb();
    if (summited && this.integration) await this.merge(route);
  }

  /** The seal an earlier run kept, back in memory for the send and the leak guard. False when it is not there. */
  private async restoreSeal(route: PlannedRoute): Promise<boolean> {
    const sealed = await this.session.runner.restoreSeal?.(route);
    if (!sealed?.files.length) return false;
    this.session.sealed.set(route.id, sealed);
    this.session.sealedCode.set(route.id, sealedCode(sealed));
    return true;
  }

  private merge(route: PlannedRoute): Promise<void> {
    const merged = this.merges.then(() => this.integration!.merge(route));
    this.merges = handled(merged);
    return merged;
  }
}

/** A route's seal while its belayer writes it: the send awaits `ready`; `done` says whether it will have to wait. */
export interface PendingSeal {
  ready: Promise<void>;
  done(): boolean;
}

function inProgress(written: Promise<void>, stop: (error: unknown) => void): PendingSeal {
  let settled = false;
  const ready = handled(written.finally(() => (settled = true)));
  ready.catch(stop);
  return { ready, done: () => settled };
}

/**
 * The same promise, marked as handled: its error reaches the climb through the route that awaits it, and Node must
 * not report it as unhandled while that route is still on its way to the await.
 */
function handled<T>(promise: Promise<T>): Promise<T> {
  promise.catch(() => undefined);
  return promise;
}
