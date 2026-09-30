import { Ascent } from "../ascent.ts";
import type { ClimbSession } from "../session.ts";
import type { Stage } from "./stage.ts";

/** Rigs and climbs every route, each as soon as the routes it starts from are in the delivery. */
export const ascentStage: Stage = {
  name: "ascent",
  appliesTo: () => true,

  async run(session: ClimbSession) {
    await new Ascent(session).run();
  },
};
