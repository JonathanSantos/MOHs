import { sealedCode } from "../crew/types.ts";
import type { PlannedRoute } from "../domain/plan.ts";
import { readText, sha256, writeText } from "../util/fs.ts";
import { ClimbAborted, type ClimbSession } from "./session.ts";
import { climbLevelWork } from "./stages/crew-errors.ts";

const MAX_SEAL_ATTEMPTS = 2;

/**
 * The bolts of one route above fluorite: the interface contract its tests and code are written against.
 * In diamond they are a signed contract, so the belayer only writes tests against an approved interface.
 */
export async function setBolts(session: ClimbSession, route: PlannedRoute): Promise<void> {
  session.journal.record("bolts.started", {}, { actor: "setter", route: route.id });
  const context = { notes: session.notes(), observer: session.observerFor({ route: route.id }) };
  const bolts = await climbLevelWork(session, "setter", () => session.crew.setBolts(route, context));
  const file = session.paths.bolts(route.id);
  writeText(file, bolts.text);
  session.journal.record("bolts.set", { hash: sha256(bolts.text) }, { actor: "setter", route: route.id, o2: bolts.o2 });
  if (route.hardness === "diamond") await signBolts(session, route);
}

/** Diamond bolts wait for a human signature bound to their text. */
export async function signBolts(session: ClimbSession, route: PlannedRoute): Promise<void> {
  const file = session.paths.bolts(route.id);
  await session.gate.awaitSignature({
    target: `bolts-${route.id}`,
    what: `Os bolts da route ${route.id}`,
    review: file,
    text: readText(file) ?? undefined,
    route: route.id,
    current: () => sha256(readText(file) ?? ""),
  });
}

/**
 * The hidden tests of one route. A sealed test that already passes proves nothing, so every test must fail on the
 * current code. The belayer writes them in a throwaway checkout and gets a second chance; after that a human decides.
 */
export async function sealRoute(session: ClimbSession, route: PlannedRoute): Promise<void> {
  const { crew, runner, journal, gate } = session;
  journal.record("seal.started", {}, { actor: "belayer", route: route.id });
  let feedback: string | undefined;
  for (let attempt = 1; ; attempt++) {
    const workspace = await runner.prepareSeal(route);
    const context = { notes: session.notes(route.id), workspace, attempt, feedback, observer: session.observerFor({ route: route.id }) };
    const seal = await climbLevelWork(session, "belayer", () => crew.seal(route, context));
    session.sealed.set(route.id, seal);
    session.sealedCode.set(route.id, sealedCode(seal));
    journal.record(
      "seal.written",
      { unit: seal.unit, e2e: seal.e2e, attempt, cases: seal.cases },
      { actor: "belayer", route: route.id, o2: seal.o2 },
    );
    if (seal.oversized) {
      const { cases, budget } = seal.oversized;
      journal.friction("seal.oversized", `${cases} casos de teste selados, acima do teto de ${budget} da route`, { route: route.id });
    }

    const red = await runner.sealRed(route, seal);
    if (red.allRed) {
      journal.record("seal.red", { total: seal.unit + seal.e2e }, { actor: "basecamp", route: route.id });
      return;
    }
    journal.friction("seal.green", `${red.passing.length} testes selados já passam no código atual: ${red.passing.join(", ")}`, {
      route: route.id,
    });
    feedback = `Estes testes já passam no código atual, então não provam nada: ${red.passing.join(", ")}. Todo teste selado precisa falhar antes da implementação.`;
    if (attempt < MAX_SEAL_ATTEMPTS) continue;

    const choice = await gate.rescue(`route ${route.id}: o seal continua com testes que já passam`, ["proceed", "abort"], route.id);
    if (choice === "abort") throw new ClimbAborted("seal sem testes vermelhos");
    return;
  }
}
