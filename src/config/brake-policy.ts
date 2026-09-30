import { SEVERITIES, type Severity } from "../domain/types.ts";
import type { BrakeYaml } from "./schema.ts";
import type { BrakePolicy, Diagnostic } from "./types.ts";

type Bucket = "block" | "warn" | "ignore";

const STRICTNESS: Record<Bucket, number> = { block: 3, warn: 2, ignore: 1 };
const BUCKETS: readonly Bucket[] = ["block", "warn", "ignore"];

/** Floors no layer can lower. */
const FLOORS = { maxFallsBeforeRescue: 5 };

const DEFAULTS = { minConfidence: 80, fallsBeforeRescue: 3, inspectionRounds: 2 };

/**
 * Turns the merged brake.yaml into a policy where every severity lands in exactly one bucket.
 * Conflicts resolve to the stricter bucket, unlisted severities warn, and `critical` always blocks.
 */
export function toBrakePolicy(yaml: BrakeYaml, diagnostics: Diagnostic[]): BrakePolicy {
  const buckets = assignBuckets(yaml, diagnostics);
  enforceCriticalBlocks(buckets, diagnostics);
  fillUnlisted(buckets, diagnostics);

  return {
    block: severitiesIn(buckets, "block"),
    warn: severitiesIn(buckets, "warn"),
    ignore: severitiesIn(buckets, "ignore"),
    minConfidence: yaml.min_confidence ?? DEFAULTS.minConfidence,
    fallsBeforeRescue: clampFalls(yaml.falls_before_rescue ?? DEFAULTS.fallsBeforeRescue, diagnostics),
    inspectionRounds: yaml.inspection_rounds ?? DEFAULTS.inspectionRounds,
  };
}

function assignBuckets(yaml: BrakeYaml, diagnostics: Diagnostic[]): Map<Severity, Bucket> {
  const buckets = new Map<Severity, Bucket>();
  for (const bucket of BUCKETS) {
    for (const severity of yaml[bucket] ?? []) {
      const current = buckets.get(severity);
      if (!current || current === bucket) {
        buckets.set(severity, bucket);
        continue;
      }
      const stricter = STRICTNESS[current] >= STRICTNESS[bucket] ? current : bucket;
      diagnostics.push({ level: "warn", message: `brake: "${severity}" aparece em ${current} e em ${bucket}; vale ${stricter}` });
      buckets.set(severity, stricter);
    }
  }
  return buckets;
}

function enforceCriticalBlocks(buckets: Map<Severity, Bucket>, diagnostics: Diagnostic[]): void {
  if (buckets.get("critical") === "block") return;
  if (buckets.has("critical")) diagnostics.push({ level: "warn", message: "brake: piso aplicado, critical sempre bloqueia" });
  buckets.set("critical", "block");
}

function fillUnlisted(buckets: Map<Severity, Bucket>, diagnostics: Diagnostic[]): void {
  for (const severity of SEVERITIES) {
    if (buckets.has(severity)) continue;
    diagnostics.push({ level: "info", message: `brake: "${severity}" não está em nenhuma lista; tratado como warn` });
    buckets.set(severity, "warn");
  }
}

function clampFalls(falls: number, diagnostics: Diagnostic[]): number {
  if (falls <= FLOORS.maxFallsBeforeRescue) return falls;
  diagnostics.push({ level: "warn", message: `brake: falls_before_rescue limitado a ${FLOORS.maxFallsBeforeRescue}` });
  return FLOORS.maxFallsBeforeRescue;
}

function severitiesIn(buckets: Map<Severity, Bucket>, bucket: Bucket): Severity[] {
  return SEVERITIES.filter((severity) => buckets.get(severity) === bucket);
}
