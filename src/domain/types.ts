export const HARDNESS = ["talc", "fluorite", "quartz", "diamond"] as const;
export type Hardness = (typeof HARDNESS)[number];

/** What the scout may choose. Talc is only asked for (`mohs fix`): once a scout has planned, the ceremony is paid. */
export const SCOUT_HARDNESS = ["fluorite", "quartz", "diamond"] as const satisfies readonly Hardness[];

/** Posição de cada hardness na escala de Mohs. */
export const MOHS_SCALE: Readonly<Record<Hardness, number>> = { talc: 1, fluorite: 4, quartz: 7, diamond: 10 };

export const ROLES = ["scout", "setter", "belayer", "climber", "inspector", "scribe"] as const;
export type Role = (typeof ROLES)[number];

export const SEVERITIES = ["critical", "high", "medium", "low"] as const;
export type Severity = (typeof SEVERITIES)[number];

export type ClimbKind = "first_ascent" | "variation";

export type FixReason = "fall" | "inspection" | "integration";

export const RESCUE_OPTIONS = ["retry", "abandon", "proceed", "abort"] as const;
export type RescueOption = (typeof RESCUE_OPTIONS)[number];

export const FRICTION_KINDS = [
  "brake.denied",
  "env",
  "spec.ambiguity",
  "anchor.failed",
  "send.fall",
  "leak.blocked",
  "inspection.blocked",
  "pack.overflow",
  "o2.exceeded",
  "line.edited",
  "signature.stale",
  "seal.green",
  "seal.oversized",
  "seal.disputed",
  "scope.drift",
  "agent.limit",
  "agent.refusal",
  "provider.error",
  "crew.note",
  "integration.conflict",
  "integration.fall",
] as const;
export type FrictionKind = (typeof FRICTION_KINDS)[number];

export interface Finding {
  inspector: string;
  severity: Severity;
  area: string;
  text: string;
  file?: string;
  line?: number;
  confidence: number;
}

export type FindingAction = "block" | "warn" | "ignore" | "dropped";

export interface ClassifiedFinding extends Finding {
  action: FindingAction;
}

export interface Proposal {
  id: string;
  kind: "skill" | "beta" | "inspector" | "config";
  target: string;
  summary: string;
  evidence: string[];
  /** The text of the file, ready to go in. Without it, the summary is what goes in. */
  content?: string;
}

export function maxHardness(list: readonly Hardness[]): Hardness {
  return list.reduce<Hardness>((hardest, h) => (MOHS_SCALE[h] > MOHS_SCALE[hardest] ? h : hardest), "talc");
}

export function isHardness(value: unknown): value is Hardness {
  return HARDNESS.includes(value as Hardness);
}

export function isRole(value: unknown): value is Role {
  return ROLES.includes(value as Role);
}

export function isRescueOption(value: unknown): value is RescueOption {
  return RESCUE_OPTIONS.includes(value as RescueOption);
}
