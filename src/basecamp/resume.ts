import { join } from "node:path";
import type { MohsEvent } from "../domain/events.ts";
import type { ClimbKind, Hardness, Intent } from "../domain/types.ts";
import type { PlannedRoute } from "../domain/plan.ts";
import { EVENTS_FILE, readEvents } from "./event-log.ts";
import { basecampAlive } from "./presence.ts";

/** How far one route went before the Basecamp stopped. */
export interface RouteProgress {
  bolted: boolean;
  /** Diamond bolts carry a human signature; without it the route waits for it again. */
  boltsSigned: boolean;
  sealed: boolean;
  /** Pitches whose anchor committed (fix anchors not counted). */
  anchored: Set<number>;
  summited: boolean;
  merged: boolean;
  /** Files the route's commits changed, for the summit's evidence. */
  touched: string[];
  decisions: string[];
}

/**
 * Where a climb stood when its Basecamp stopped, read from the event log alone. A resumed Basecamp skips what is done
 * and picks up the rest; the worktrees, the kept seal and the open task files are still on disk.
 */
export interface ResumePoint {
  request: string;
  solo: boolean;
  lastSeq: number;
  surveyed: boolean;
  plan?: { kind: ClimbKind; hardness: Hardness; intent?: Intent; routes: PlannedRoute[] };
  line: "none" | "drafted" | "signed";
  /** The bug's reproduction is red and kept: a resumed climb restores it instead of asking again. */
  reproduced: boolean;
  reproduction?: { shows: string; output: string };
  routes: Map<string, RouteProgress>;
  integrated: boolean;
  descended: boolean;
}

export function resumePoint(events: readonly MohsEvent[]): ResumePoint {
  const has = (type: MohsEvent["type"], route?: string) =>
    events.some((e) => e.type === type && (route === undefined || e.route === route));
  const planned = events.findLast((e) => e.type === "scout.hardness");
  const started = events.find((e) => e.type === "climb.started");
  const plan =
    planned?.type === "scout.hardness"
      ? {
          kind: planned.data.kind,
          hardness: planned.data.hardness,
          intent: planned.data.intent,
          routes: planned.data.routes.map(({ budget: _budget, ...route }) => route),
        }
      : undefined;

  const routes = new Map<string, RouteProgress>();
  for (const route of plan?.routes ?? []) {
    const own = events.filter((e) => e.route === route.id);
    const anchors = own.filter((e) => e.type === "pitch.anchor");
    const decisions = own.findLast((e) => e.type === "decisions.taken");
    routes.set(route.id, {
      bolted: has("bolts.set", route.id),
      boltsSigned: own.some((e) => e.type === "signature.given" && e.data.target === `bolts-${route.id}`),
      sealed: has("seal.red", route.id),
      anchored: new Set(anchors.flatMap((e) => (e.type === "pitch.anchor" && !e.data.fix && e.pitch ? [e.pitch] : []))),
      summited: has("route.summit", route.id),
      merged: has("integration.merged", route.id),
      touched: anchors.flatMap((e) => (e.type === "pitch.anchor" ? (e.data.files ?? []) : [])),
      decisions: decisions?.type === "decisions.taken" ? decisions.data.decisions : [],
    });
  }

  return {
    request: started?.type === "climb.started" ? started.data.request : "",
    solo: started?.type === "climb.started" && Boolean(started.data.solo),
    lastSeq: events.at(-1)?.seq ?? 0,
    surveyed: has("survey.ready"),
    plan,
    line: has("line.signed") ? "signed" : has("line.drafted") ? "drafted" : "none",
    reproduced: has("repro.red"),
    reproduction: (() => {
      const red = events.findLast((e) => e.type === "repro.red");
      return red?.type === "repro.red" ? { shows: red.data.shows, output: red.data.output } : undefined;
    })(),
    routes,
    integrated: has("integration.done"),
    descended: has("descent.beta"),
  };
}

/** Whether the climb runs solo, from its first event: the CLI reads it to drop the rules that keep roles apart. */
export function isSoloClimb(climbDir: string): boolean {
  const started = readEvents(join(climbDir, EVENTS_FILE)).find((event) => event.type === "climb.started");
  return started?.type === "climb.started" && Boolean(started.data.solo);
}

const ENDED: readonly MohsEvent["type"][] = ["climb.done", "climb.aborted", "climb.escalated"];

/** Why this climb cannot be resumed, or null when it can: it must exist, have stopped, and not have ended. */
export function resumeProblem(climbDir: string): string | null {
  const events = readEvents(join(climbDir, EVENTS_FILE));
  if (!events.length) return "não há log desse climb";
  if (basecampAlive(climbDir)) return "o Basecamp desse climb ainda está rodando";
  const ended = events.findLast((event) => ENDED.includes(event.type));
  return ended ? `o climb já terminou (${ended.type})` : null;
}
