import { CrewError } from "../../crew/types.ts";
import { MOHS_SCALE, type FrictionKind } from "../../domain/types.ts";
import type { ClimbSession } from "../session.ts";
import type { Stage } from "./stage.ts";

/** Friction that only records what the crew noticed: on its own, nothing went wrong to learn from. */
const NOTES_ONLY: ReadonlySet<FrictionKind> = new Set(["crew.note"]);

/**
 * The scribe reads the friction and proposes beta. Nothing is applied without a human choosing it. A climb with no
 * friction has nothing to teach, so it has no descent. The routes are already at the summit, so a scribe that fails
 * becomes friction, never an aborted climb.
 */
export const descentStage: Stage = {
  name: "descent",
  appliesTo: ({ plan, resume, view }) =>
    MOHS_SCALE[plan.hardness] > MOHS_SCALE.fluorite && !resume?.descended && view.friction.some((f) => !NOTES_ONLY.has(f.kind)),

  async run(session: ClimbSession) {
    const { crew, journal, view } = session;
    journal.record("descent.started", {}, { actor: "scribe" });
    try {
      const descent = await crew.descent(view, { notes: session.notes(), observer: session.observerFor() });
      journal.record("descent.beta", { proposals: descent.proposals }, { actor: "scribe", o2: descent.o2 });
    } catch (error) {
      if (!(error instanceof CrewError)) throw error;
      journal.friction(error.kind, `scribe: ${error.message}`, { o2: error.o2 });
      journal.record("descent.beta", { proposals: [] }, { actor: "scribe" });
    }
  },
};
