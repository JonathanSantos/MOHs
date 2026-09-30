import { normalizePath } from "../util/glob.ts";

export interface WindowRoute {
  id: string;
  files: readonly string[];
  after?: readonly string[];
}

/**
 * Groups routes into windows. Routes in the same window share no files and climb in parallel; a route with
 * `after` goes in a window later than every route it depends on, so it starts from their result.
 * Greedy and deterministic: dependencies first, then each route joins the first window it may.
 */
export function planWindows<T extends WindowRoute>(routes: readonly T[]): T[][] {
  const windows: { routes: T[]; files: Set<string> }[] = [];
  const placed = new Map<string, number>();
  for (const route of dependenciesFirst(routes)) {
    const files = route.files.map(normalizePath);
    const earliest = Math.max(0, ...(route.after ?? []).map((id) => (placed.get(id) ?? -1) + 1));
    let index = windows.findIndex((w, i) => i >= earliest && !files.some((file) => conflicts(file, w.files)));
    if (index === -1) {
      index = Math.max(windows.length, earliest);
      while (windows.length <= index) windows.push({ routes: [], files: new Set() });
    }
    windows[index].routes.push(route);
    for (const file of files) windows[index].files.add(file);
    placed.set(route.id, index);
  }
  return windows.map((w) => w.routes).filter((w) => w.length);
}

/**
 * The routes a route waits for before it starts: those it depends on, and those of an earlier window that share files
 * with it. It starts from their code in the delivery; every other route may go up at the same time.
 */
export function blockersOf<T extends WindowRoute>(route: T, windows: readonly (readonly T[])[]): string[] {
  const index = windows.findIndex((window) => window.includes(route));
  const files = route.files.map(normalizePath);
  const taken = (other: T) => new Set(other.files.map(normalizePath));
  return windows
    .slice(0, Math.max(0, index))
    .flat()
    .filter((other) => route.after?.includes(other.id) || files.some((file) => conflicts(file, taken(other))))
    .map((other) => other.id);
}

/** The routes in their planned order, except that a route never comes before one it depends on. */
function dependenciesFirst<T extends WindowRoute>(routes: readonly T[]): T[] {
  const byId = new Map(routes.map((route) => [route.id, route]));
  const ordered: T[] = [];
  const visiting = new Set<string>();
  const visit = (route: T) => {
    if (ordered.includes(route) || visiting.has(route.id)) return;
    visiting.add(route.id);
    for (const id of route.after ?? []) {
      const dependency = byId.get(id);
      if (dependency) visit(dependency);
    }
    ordered.push(route);
  };
  for (const route of routes) visit(route);
  return ordered;
}

/** Same file, or one is a folder (ending in `/`) that contains the other. */
function conflicts(file: string, taken: ReadonlySet<string>): boolean {
  if (taken.has(file)) return true;
  for (const other of taken) {
    if ((other.endsWith("/") && file.startsWith(other)) || (file.endsWith("/") && other.startsWith(file))) return true;
  }
  return false;
}
