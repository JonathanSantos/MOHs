import { ascentStage } from "./ascent.ts";
import { croquiStage } from "./croqui.ts";
import { descentStage } from "./descent.ts";
import { integrationStage } from "./integration.ts";
import { lineStage } from "./line.ts";
import { scoutStage } from "./scout.ts";
import type { Stage } from "./stage.ts";
import { surveyStage } from "./survey.ts";

export type { Stage } from "./stage.ts";

export const DEFAULT_STAGES: readonly Stage[] = [surveyStage, scoutStage, lineStage, ascentStage, integrationStage, descentStage];

/** What each kind of climb runs: a normal climb, or the croqui (`mohs croqui`). */
export const STAGE_SETS = {
  climb: DEFAULT_STAGES,
  croqui: [surveyStage, croquiStage],
} as const satisfies Record<string, readonly Stage[]>;

export type ClimbMode = keyof typeof STAGE_SETS;

export function isClimbMode(value: unknown): value is ClimbMode {
  return typeof value === "string" && Object.hasOwn(STAGE_SETS, value);
}
