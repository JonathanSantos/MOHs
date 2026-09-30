import { pathToFileURL } from "node:url";
import type { CheckRef } from "../config/types.ts";
import type { PlannedRoute } from "../domain/plan.ts";
import type { Severity } from "../domain/types.ts";
import type { CheckContext, CheckDefinition } from "../index.ts";
import { bestMatch } from "../util/glob.ts";

export type Exec = CheckContext["exec"];

export interface CheckFailure {
  name: string;
  severity: Severity;
  message: string;
}

const MOMENTS: readonly CheckDefinition["at"][] = ["anchor", "send", "summit"];

/** Imports every `.mohs/checks` file. A file that does not export a check made with `defineCheck` is a problem to fix first. */
export async function loadChecks(refs: readonly CheckRef[]): Promise<{ checks: CheckDefinition[]; problems: string[] }> {
  const checks: CheckDefinition[] = [];
  const problems: string[] = [];
  for (const ref of refs) {
    try {
      const module = (await import(pathToFileURL(ref.file).href)) as { default?: unknown };
      const check = module.default as CheckDefinition | undefined;
      if (!check || typeof check.run !== "function" || typeof check.name !== "string" || !MOMENTS.includes(check.at)) {
        problems.push(`${ref.file}: exporte um check feito com defineCheck (export default defineCheck({ name, at, run }))`);
        continue;
      }
      checks.push(check);
    } catch (error) {
      problems.push(`${ref.file}: ${(error as Error).message}`);
    }
  }
  return { checks, problems };
}

/** The checks for this moment that apply to the route: its hardness and the files it touches. */
export function checksAt(
  checks: readonly CheckDefinition[],
  at: CheckDefinition["at"],
  route: PlannedRoute,
  files: readonly string[],
): CheckDefinition[] {
  return checks.filter((check) => {
    if (check.at !== at) return false;
    if (check.when?.hardness && !check.when.hardness.includes(route.hardness)) return false;
    return !check.when?.files || bestMatch(files, check.when.files) !== null;
  });
}

/** Runs the given checks. A check that throws counts as failed, with the error as its message. */
export async function runChecks(
  checks: readonly CheckDefinition[],
  route: PlannedRoute,
  files: readonly string[],
  exec: Exec,
): Promise<CheckFailure[]> {
  const failures: CheckFailure[] = [];
  for (const check of checks) {
    try {
      const result = await check.run({ route: route.id, hardness: route.hardness, files: [...files], exec });
      if (!result.ok) failures.push({ name: check.name, severity: result.severity ?? "high", message: result.message ?? "falhou" });
    } catch (error) {
      failures.push({ name: check.name, severity: "high", message: `o check quebrou: ${(error as Error).message}` });
    }
  }
  return failures;
}
