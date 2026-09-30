import type { Layer } from "./layers.ts";
import type { CheckRef, Diagnostic, RackItem } from "./types.ts";

/** Objects merge deeply; arrays and scalars from `source` replace what was there. */
export function deepMerge<T>(target: T, source: unknown): T {
  if (source === undefined || source === null) return target;
  if (Array.isArray(source)) return [...source] as T;
  if (typeof source !== "object") return source as T;

  const merged: Record<string, unknown> = isRecord(target) ? { ...target } : {};
  for (const [key, value] of Object.entries(source)) {
    if (value !== undefined) merged[key] = deepMerge(merged[key], value);
  }
  return merged as T;
}

/** Items with the same kind and name: the later layer wins and remembers whom it replaced. */
export function mergeItems(layers: readonly Layer[], diagnostics: Diagnostic[]): RackItem[] {
  const byKey = new Map<string, RackItem>();
  for (const layer of layers) {
    const seenInLayer = new Set<string>();
    for (const item of layer.items) {
      const key = `${item.kind}:${item.name}`;
      if (seenInLayer.has(key)) {
        diagnostics.push({
          level: "warn",
          file: item.file,
          message: `${item.kind} "${item.name}" definido duas vezes em ${layer.label}; vale o último`,
        });
      }
      seenInLayer.add(key);
      const previous = byKey.get(key);
      byKey.set(key, previous ? { ...item, replaced: [...previous.replaced, previous.layer] } : item);
    }
  }
  return [...byKey.values()].sort(byName);
}

export function mergeChecks(layers: readonly Layer[]): CheckRef[] {
  const byName = new Map<string, CheckRef>();
  for (const check of layers.flatMap((layer) => layer.checks)) byName.set(check.name, check);
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
}

function byName(a: RackItem, b: RackItem): number {
  return a.name.localeCompare(b.name);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
