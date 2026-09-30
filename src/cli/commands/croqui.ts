import { loadConfig } from "../../config/load.ts";
import { renderCroqui } from "../../domain/croqui.ts";
import { defineCommand } from "../command.ts";
import { fail, ink, print } from "../terminal.ts";
import { climbCommand } from "./climb.ts";

const { mode: _mode, hardness: _hardness, from: _from, resume: _resume, ...flags } = climbCommand.flags;

/**
 * The project's croqui: a reading task for the scout, signed by a human, kept in `.mohs/` and carried by every later
 * climb. `--show` prints the signed one, marking what may be outdated.
 */
export const croquiCommand = defineCommand({
  name: "croqui",
  summary: "desenha o croqui do projeto (intenção, entidades, áreas sensíveis), assinado por um humano; --show mostra o atual",
  flags: { ...flags, show: { type: "boolean", description: "mostra o croqui assinado, com o que pode estar desatualizado" } },

  run(context) {
    const { show, ...rest } = context.flags;
    if (!show) {
      const flags = { ...rest, mode: "croqui", hardness: undefined, from: undefined, resume: undefined };
      return climbCommand.run({ ...context, args: ["Desenhar o croqui do projeto"], flags });
    }
    const { croqui } = loadConfig({ projectRoot: context.projectRoot });
    if (!croqui) return fail(`este projeto ainda não tem croqui. Desenhe com: mohs croqui --detach`);
    print(
      `${ink.bold("Croqui")} · assinado por ${croqui.signedBy} em ${croqui.signedAt.slice(0, 10)}`,
      "",
      renderCroqui(croqui, { full: true, stale: croqui.stale }),
    );
    if (croqui.stale.length)
      print("", ink.warn(`${croqui.stale.length} arquivo(s) citado(s) mudaram desde a assinatura. Para redesenhar: mohs croqui --detach`));
    return 0;
  },
});
