import { join } from "node:path";
import { EVENTS_FILE, readEvents } from "../../basecamp/event-log.ts";
import { project } from "../../view/reducer.ts";
import { CLIMB_FLAG, NO_CLIMB, resolveClimbDir } from "../climb-dir.ts";
import { defineCommand } from "../command.ts";
import { fail, ink, print } from "../terminal.ts";

export const lineCommand = defineCommand({
  name: "line",
  summary: "mostra a line do climb como foi gravada, e se já está assinada",
  flags: CLIMB_FLAG,

  run({ projectRoot, flags }) {
    const dir = resolveClimbDir(projectRoot, flags.climb);
    if (!dir) return fail(NO_CLIMB);
    const { line } = project(readEvents(join(dir, EVENTS_FILE)));
    if (!line) return fail("este climb ainda não tem line");
    const status = line.signed ? ink.ok(`assinada por ${line.signedBy}`) : ink.warn("aguardando assinatura");
    print(ink.dim(`line ${line.hash.slice(0, 12)} · ${status}`), "", line.text.trimEnd());
    return 0;
  },
});
