import { MOHS_SCALE, type Hardness } from "./types.ts";

export interface PlannedPitch {
  title: string;
  files: string[];
  crux?: boolean;
}

export interface PlannedRoute {
  id: string;
  name: string;
  hardness: Hardness;
  files: string[];
  tags: string[];
  pitches: PlannedPitch[];
  /** Routes that must reach the summit first; this one starts from their result. */
  after?: string[];
}

export interface PlannedRouteWithBudget extends PlannedRoute {
  budget: number;
}

/** Quartz and up: bolts, sealed tests and a send before the summit. */
export function isRigged(route: Pick<PlannedRoute, "hardness">): boolean {
  return MOHS_SCALE[route.hardness] >= MOHS_SCALE.quartz;
}

/** The order the routes go up in, for people: `A → B + C` (B and C together, after A). */
export function describeWindows(windows: readonly (readonly string[])[]): string {
  return windows.map((window) => window.join(" + ")).join(" → ");
}
