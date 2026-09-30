/**
 * Public API for MOHs extensions. Today: TypeScript checks (`.mohs/checks/*.ts`).
 */
import type { Hardness, Severity } from "./domain/types.ts";

export type { Hardness, Role, Severity } from "./domain/types.ts";

export interface CheckContext {
  route: string;
  hardness: Hardness;
  /** Files the route touches: the pitch's at the anchor, the whole route at send and summit. */
  files: string[];
  /** Runs a command in the route's worktree (shell, same timeout as the anchor). */
  exec(command: string): Promise<{ code: number; output: string }>;
}

export interface CheckResult {
  ok: boolean;
  severity?: Severity;
  message?: string;
}

export interface CheckDefinition {
  name: string;
  /**
   * When the Basecamp runs the check. `anchor`: with the anchor commands, before the commit; a failure sends the
   * pitch back. `send` (right after a clean send) and `summit` (before the summit, every hardness): a failure is a
   * finding the brake classifies by its severity (high when not given).
   */
  at: "anchor" | "send" | "summit";
  when?: { files?: string[]; hardness?: Hardness[] };
  run(context: CheckContext): Promise<CheckResult> | CheckResult;
}

/** Identity helper: gives a `.mohs/checks/*.ts` file full type checking. */
export function defineCheck(definition: CheckDefinition): CheckDefinition {
  return definition;
}
