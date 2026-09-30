import { CrewError } from "../../crew/types.ts";
import { ClimbAborted, type ClimbSession } from "../session.ts";

/**
 * Climb-level crew work (scout, setter) has no route to abandon: if the agent stops or its provider
 * fails, the failure is recorded as friction and the climb stops with a readable reason.
 */
export async function climbLevelWork<T>(session: ClimbSession, role: string, work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    if (!(error instanceof CrewError)) throw error;
    session.journal.friction(error.kind, error.message, { o2: error.o2 });
    throw new ClimbAborted(`${role}: ${error.message}`, "basecamp");
  }
}
