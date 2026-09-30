import { join } from "node:path";
import { settle, signedLine } from "../domain/decisions.ts";
import type { RescueOption } from "../domain/types.ts";
import { readText, sha256, writeText } from "../util/fs.ts";
import type { ClimbView } from "../view/types.ts";
import { CLIMB_FILES, LINE_TARGET, type Desk } from "./desk.ts";
import type { Journal } from "./journal.ts";

interface GateDependencies {
  desk: Desk;
  dir: string;
  journal: Journal;
  view: ClimbView;
}

export interface GateSignature {
  target: string;
  /** What is being signed, for people: "Os bolts da route A". */
  what: string;
  /** Where to review it: a file, a branch. */
  review: string;
  /** The text itself, when it is short enough to show in the Lookout. */
  text?: string;
  route?: string;
  current(): string;
}

/** The moments the Basecamp stops for a human: signing the line, bolts or a summit, and answering a rescue. */
export class HumanGate {
  private readonly deps: GateDependencies;
  private rescueQueue: Promise<unknown> = Promise.resolve();

  constructor(deps: GateDependencies) {
    this.deps = deps;
  }

  /**
   * Waits until someone signs the line as it reads now. If the file changed after it was drafted,
   * the new text becomes a new draft and only a signature of that text is accepted. A line with decisions is signed
   * with the human's choices: the signed line keeps only what was decided (`line.decided`), and that is what the
   * crew reads from then on.
   */
  async awaitLineSignature(): Promise<void> {
    const { desk, dir, journal, view } = this.deps;
    const file = join(dir, CLIMB_FILES.line);
    const current = () => sha256(readText(file) ?? "");
    for (;;) {
      const signature = await desk.waitForSignature(dir, { target: LINE_TARGET, current });
      const text = readText(file) ?? "";
      const now = current();

      const edited = now !== view.line?.hash;
      if (edited) {
        journal.record("line.drafted", { hash: now, text }, { actor: "human" });
        journal.friction("line.edited", "a line mudou antes da assinatura; a assinatura precisa ser do texto novo");
      }
      if (signature.hash === now) {
        const { body, decisions } = view.line ?? {};
        if (body === undefined || !decisions?.length) {
          journal.record("line.signed", { hash: now, by: signature.by }, { actor: "human" });
          return;
        }
        // Quem assina pela CLI ou pelo Lookout já teve as escolhas conferidas; uma inválida fica com a recomendada.
        const { settled } = settle(decisions, signature.choices);
        const signed = signedLine(body, settled);
        const hash = sha256(signed);
        writeText(file, signed);
        journal.record("line.decided", { hash, text: signed, decisions: settled }, { actor: "human" });
        journal.record("line.signed", { hash, by: signature.by }, { actor: "human" });
        return;
      }
      if (!edited) journal.friction("signature.stale", "assinatura de uma versão anterior da line");
    }
  }

  /**
   * Waits until a human signs `target` as it stands now: diamond bolts, a diamond summit. A signature of an older
   * version is refused and recorded as friction, like the line's.
   */
  async awaitSignature(request: GateSignature): Promise<void> {
    const { desk, dir, journal } = this.deps;
    const { target, what, review, text, route, current } = request;
    journal.record("signature.requested", { target, what, review, text, hash: current() }, { actor: "basecamp", route });
    for (;;) {
      const signature = await desk.waitForSignature(dir, { target, current });
      if (signature.hash === current()) {
        journal.record("signature.given", { target, hash: signature.hash, by: signature.by }, { actor: "human", route });
        return;
      }
      journal.friction("signature.stale", `assinatura de uma versão anterior de ${what.toLowerCase()}`, { route });
    }
  }

  /**
   * Asks a human to decide. Rescues are queued: two routes asking at the same time
   * are answered one after the other, never interleaved.
   */
  rescue(reason: string, options: RescueOption[], route?: string): Promise<RescueOption> {
    const ask = async () => {
      const { desk, dir, journal } = this.deps;
      journal.call({ call: "TAKE", from: "basecamp", to: "human", reason, options }, { route });
      journal.record("rescue.called", { reason, options }, { actor: "basecamp", route });
      const option = await desk.waitForRescue(dir, options);
      journal.record("rescue.resolved", { option }, { actor: "human", route });
      return option;
    };
    const answer = this.rescueQueue.then(ask, ask);
    this.rescueQueue = answer.catch(() => undefined);
    return answer;
  }
}
