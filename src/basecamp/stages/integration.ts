import type { ClimbSession } from "../session.ts";
import type { Stage } from "./stage.ts";

/** Every route's sealed tests, the anchor and the full suite on the delivery branch, until it is clean. */
export const integrationStage: Stage = {
  name: "integration",
  appliesTo: ({ integration, resume }) => Boolean(integration?.routes.length) && !resume?.integrated,

  async run({ integration }: ClimbSession) {
    await integration!.check();
    await integration!.finish();
  },
};
