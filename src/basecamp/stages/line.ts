import { checkAgainst, numberDecisions, reviewLine } from "../../domain/decisions.ts";
import { reproText } from "../route-climber.ts";
import { sha256, writeText } from "../../util/fs.ts";
import type { ClimbSession } from "../session.ts";
import { climbLevelWork } from "./crew-errors.ts";
import type { Stage } from "./stage.ts";

/**
 * The setter drafts the line and the climb waits for a human signature bound to its hash. In a fluorite climb the
 * scout may have written it with the plan: one task less, and the human signs the same way.
 */
export const lineStage: Stage = {
  name: "line",
  // Talc não tem line: as decisões do climber vão para a assinatura no fim.
  appliesTo: ({ plan, resume }) => plan.hardness !== "talc" && resume?.line !== "signed",

  async run(session: ClimbSession) {
    const { crew, journal, gate } = session;
    // Retomado com a line já escrita: falta só a assinatura.
    if (session.resume?.line === "drafted") return gate.awaitLineSignature();
    const author = session.plan.line ? "scout" : "setter";
    journal.record("line.started", {}, { actor: author });
    const line = session.plan.line
      ? { text: session.plan.line, decisions: session.plan.decisions, o2: 0 }
      : await climbLevelWork(session, "setter", () =>
          crew.writeLine(session.request, session.plan.routes, session.survey, {
            observer: session.observerFor(),
            solo: session.solo,
            intent: session.plan.intent,
            repro: session.repro ? reproText(session.repro.files, session.repro.shows) : undefined,
          }),
        );
    // As decisões vêm à parte: o humano as lê com as opções e escolhe ao assinar.
    const { decisions, dropped } = checkAgainst(numberDecisions(line.decisions ?? []), session.request);
    if (dropped.length) {
      journal.friction("spec.ambiguity", `aviso de "contraria o pedido" sem trecho do pedido, descartado: ${dropped.join(", ")}`);
    }
    const text = reviewLine(line.text, decisions);
    writeText(session.paths.line, text);
    const structured = decisions.length ? { body: line.text, decisions } : {};
    journal.record("line.drafted", { hash: sha256(text), text, ...structured }, { actor: author, o2: line.o2 });
    await gate.awaitLineSignature();
  },
};
