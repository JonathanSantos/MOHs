import { CrewError } from "../../crew/types.ts";
import { MOHS_SCALE } from "../../domain/types.ts";
import type { ClimbSession } from "../session.ts";
import type { Stage } from "./stage.ts";

/**
 * The scribe reads the friction and proposes beta. Nothing is applied without a human choosing it.
 * The routes are already at the summit, so a scribe that fails becomes friction, never an aborted climb.
 */
export const descentStage: Stage = {
  name: "descent",
  appliesTo: ({ plan, resume }) => MOHS_SCALE[plan.hardness] > MOHS_SCALE.fluorite && !resume?.descended,

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
