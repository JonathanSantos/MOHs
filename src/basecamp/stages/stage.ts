import type { ClimbSession } from "../session.ts";

/**
 * One step of the climb. The Basecamp runs its stages in order and skips those that do not apply,
 * so a new ceremony is a new Stage, not another branch inside the Basecamp.
 */
export interface Stage {
  readonly name: string;
  appliesTo(session: ClimbSession): boolean;
  run(session: ClimbSession): Promise<void>;
}
