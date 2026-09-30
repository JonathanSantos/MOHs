import { join } from "node:path";
import type { MohsEvent } from "../domain/events.ts";
import { HARDNESS, type FrictionKind, type Hardness } from "../domain/types.ts";
import { climbDir, EVENTS_FILE, listClimbIds, readEvents } from "./event-log.ts";

export interface Averages {
  /** Mean time from route.started to route.summit, per hardness. */
  routes: Record<Hardness, { count: number; avgMs: number }>;
  climbs: number;
  friction: Partial<Record<FrictionKind, number>>;
}

export function computeAverages(climbs: readonly MohsEvent[][]): Averages {
  const totals = Object.fromEntries(HARDNESS.map((h) => [h, { count: 0, ms: 0 }])) as Record<Hardness, { count: number; ms: number }>;
  const friction: Averages["friction"] = {};

  for (const events of climbs) {
    const hardnessOf = new Map<string, Hardness>();
    const startedAt = new Map<string, number>();
    for (const event of events) {
      switch (event.type) {
        case "scout.hardness":
          for (const route of event.data.routes) hardnessOf.set(route.id, route.hardness);
          break;
        case "scout.escalated":
          if (event.route) hardnessOf.set(event.route, event.data.to);
          break;
        case "route.started":
          if (event.route) startedAt.set(event.route, Date.parse(event.ts));
          break;
        case "route.summit": {
          const start = event.route ? startedAt.get(event.route) : undefined;
          const hardness = event.route ? hardnessOf.get(event.route) : undefined;
          if (start === undefined || !hardness) break;
          totals[hardness].count++;
          totals[hardness].ms += Date.parse(event.ts) - start;
          break;
        }
        case "friction":
          friction[event.data.kind] = (friction[event.data.kind] ?? 0) + 1;
          break;
      }
    }
  }

  const routes = Object.fromEntries(
    HARDNESS.map((h) => [h, { count: totals[h].count, avgMs: totals[h].count ? Math.round(totals[h].ms / totals[h].count) : 0 }]),
  ) as Averages["routes"];
  return { routes, climbs: climbs.length, friction };
}

export function loadHistory(mohsDir: string): MohsEvent[][] {
  return listClimbIds(mohsDir).map((id) => readEvents(join(climbDir(mohsDir, id), EVENTS_FILE)));
}
