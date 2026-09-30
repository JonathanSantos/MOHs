import { CEREMONIES } from "../../domain/ceremony.ts";
import { ClimbAborted, type ClimbSession } from "../session.ts";
import { climbLevelWork } from "./crew-errors.ts";
import type { Stage } from "./stage.ts";

const MAX_REPRO_ATTEMPTS = 2;

/**
 * A bug is proven before it is planned: the reproducer writes a test that fails on the code as it is, in a throwaway
 * checkout, and the Basecamp runs it to check. The setter plans with it, the climber of the first route sees it, and it
 * runs at that route's send; at the summit it joins the project as a regression test. A crew or runner without the
 * step skips it.
 */
export const reproStage: Stage = {
  name: "repro",
  appliesTo: ({ plan, crew, runner }) =>
    plan.hardness !== "talc" &&
    Boolean(plan.intent && CEREMONIES[plan.intent].reproduce) &&
    Boolean(crew.reproduce && runner.prepareRepro && runner.reproRed),

  async run(session: ClimbSession) {
    const { crew, runner, journal, gate, request, survey } = session;
    if (session.resume?.reproduced) {
      const files = await runner.restoreRepro?.();
      const red = session.resume.reproduction;
      if (files?.length && red) session.repro = { files, shows: red.shows, output: red.output };
      return;
    }
    journal.record("repro.started", {}, { actor: "reproducer" });
    let feedback: string | undefined;
    for (let attempt = 1; ; attempt++) {
      const workspace = await runner.prepareRepro!();
      const context = { workspace, attempt, feedback, solo: session.solo, observer: session.observerFor() };
      const repro = await climbLevelWork(session, "reproducer", () => crew.reproduce!(request, survey, context));
      const files = repro.files.map((file) => file.path);
      journal.record("repro.written", { files, shows: repro.shows, attempt }, { actor: "reproducer", o2: repro.o2 });
      const red = await runner.reproRed!(repro.files);
      if (red.allRed) {
        session.repro = { files: repro.files, shows: repro.shows, output: red.output };
        journal.record("repro.red", { files, shows: repro.shows, output: red.output }, { actor: "basecamp" });
        return;
      }
      journal.friction("repro.green", `o teste de reprodução passa no código de hoje: ${red.passing.join(", ")}`);
      feedback = `Estes testes passam no código de hoje, então não reproduzem o bug: ${red.passing.join(", ")}. O teste precisa falhar pelo motivo do bug.`;
      if (attempt < MAX_REPRO_ATTEMPTS) continue;
      const choice = await gate.rescue("o bug não foi reproduzido num teste que falha hoje", ["proceed", "abort"]);
      if (choice === "abort") throw new ClimbAborted("bug sem reprodução");
      return;
    }
  },
};
