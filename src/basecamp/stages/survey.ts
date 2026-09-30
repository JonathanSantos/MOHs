import type { ClimbSession } from "../session.ts";
import type { Stage } from "./stage.ts";

/**
 * Maps the project with code only (zero O₂) and decides first ascent versus variation by rule.
 * It always runs first: every later stage plans against real files.
 */
export const surveyStage: Stage = {
  name: "survey",
  appliesTo: () => true,

  async run(session: ClimbSession) {
    const { runner, journal } = session;
    // Retomado: o survey é código e custa zero O₂; refeito em silêncio, porque o log já o registrou.
    if (session.resume?.surveyed) {
      session.survey = await runner.survey();
      return;
    }
    journal.record("survey.started", {}, { actor: "basecamp" });
    session.survey = await runner.survey();
    const { kind, files, summary } = session.survey;
    journal.record("survey.ready", { kind, files, summary }, { actor: "basecamp" });
  },
};
