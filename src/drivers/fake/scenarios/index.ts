import { quickFix } from "./quick-fix.ts";
import { shareLink } from "./share-link.ts";
import type { Scenario } from "./types.ts";

export type { Scenario, ScenarioFailure, ScenarioPitch, ScenarioRoute } from "./types.ts";

export const SCENARIOS: Readonly<Record<string, Scenario>> = {
  [shareLink.name]: shareLink,
  [quickFix.name]: quickFix,
};

export function getScenario(name: string): Scenario {
  const scenario = SCENARIOS[name];
  if (!scenario) throw new Error(`Unknown scenario "${name}". Available: ${Object.keys(SCENARIOS).join(", ")}`);
  return scenario;
}
