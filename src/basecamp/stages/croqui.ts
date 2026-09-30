import { join } from "node:path";
import { CROQUI_FILE, CROQUI_VIEW, hashCited } from "../../config/croqui.ts";
import { citedFiles, renderCroqui, type Croqui, type SignedCroqui } from "../../domain/croqui.ts";
import { readText, sha256, writeText } from "../../util/fs.ts";
import type { ClimbSession } from "../session.ts";
import { climbLevelWork } from "./crew-errors.ts";
import type { Stage } from "./stage.ts";

/**
 * Draws the project's croqui (`mohs croqui`): the scout sketches it, a human signs it, and it goes to `.mohs/` for
 * every later climb, with the hash of each cited file so parts that may be outdated show as such.
 */
export const croquiStage: Stage = {
  name: "croqui",
  appliesTo: () => true,

  async run(session: ClimbSession) {
    const { crew, journal, gate, config, view } = session;
    journal.record("croqui.started", {}, { actor: "scout" });
    const drawn = await climbLevelWork(session, "scout", () => crew.drawCroqui(session.survey, { observer: session.observerFor() }));
    // O rascunho fica no climb: o humano lê o .md e, se quiser, edita o .json antes de assinar.
    const draft = join(session.dir, CROQUI_FILE);
    writeText(draft, JSON.stringify(drawn.croqui, null, 2));
    writeText(join(session.dir, CROQUI_VIEW), `# Croqui\n\n${renderCroqui(drawn.croqui, { full: true })}\n`);
    const current = () => sha256(readText(draft) ?? "");
    journal.record(
      "croqui.drafted",
      { hash: current(), entities: drawn.croqui.entities.length, sections: drawn.croqui.sections.length },
      { actor: "scout", o2: drawn.o2 },
    );
    await gate.awaitSignature({
      target: "croqui",
      what: "O croqui do projeto",
      review: join(session.dir, CROQUI_VIEW),
      text: drawn.croqui.purpose,
      current,
    });

    const croqui = JSON.parse(readText(draft) ?? "{}") as Croqui;
    const signature = view.signatures.find((s) => s.target === "croqui");
    const signed: SignedCroqui = {
      ...croqui,
      signedBy: signature?.by ?? "humano",
      signedAt: new Date().toISOString(),
      hash: current(),
      cited: hashCited(config.projectRoot, citedFiles(croqui)),
    };
    writeText(join(config.mohsDir, CROQUI_FILE), JSON.stringify(signed, null, 2));
    writeText(join(config.mohsDir, CROQUI_VIEW), `# Croqui\n\n${renderCroqui(croqui, { full: true })}\n`);
    journal.record("croqui.saved", { file: `.mohs/${CROQUI_VIEW}` }, { actor: "basecamp" });
  },
};
