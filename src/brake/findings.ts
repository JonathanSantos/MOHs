import type { BrakePolicy } from "../config/types.ts";
import type { ClassifiedFinding, Finding, FindingAction } from "../domain/types.ts";

/**
 * Applies the brake policy to inspector findings. Code decides, not the model:
 * low-confidence findings are dropped, except `critical`, which always blocks.
 */
export function classifyFindings(findings: readonly Finding[], policy: BrakePolicy): ClassifiedFinding[] {
  return findings.map((finding) => ({ ...finding, action: actionFor(finding, policy) }));
}

function actionFor(finding: Finding, policy: BrakePolicy): FindingAction {
  if (finding.severity === "critical") return "block";
  if (finding.confidence < policy.minConfidence) return "dropped";
  if (policy.block.includes(finding.severity)) return "block";
  if (policy.warn.includes(finding.severity)) return "warn";
  return "ignore";
}
