import { join, relative } from "node:path";
import { answerRescue, LINE_TARGET, sign, signLine } from "../../basecamp/desk.ts";
import { EVENTS_FILE, readEvents } from "../../basecamp/event-log.ts";
import { parseChoice, settle } from "../../domain/decisions.ts";
import { isRescueOption, RESCUE_OPTIONS } from "../../domain/types.ts";
import { currentUser } from "../../util/runtime.ts";
import { project } from "../../view/reducer.ts";
import { CLIMB_FLAG, NO_CLIMB, resolveClimbDir } from "../climb-dir.ts";
import { defineCommand } from "../command.ts";
import { fail, ink, print } from "../terminal.ts";

export const signCommand = defineCommand({
  name: "sign",
  args: "[alvo] [D1=B …]",
  summary:
    'assina o que espera assinatura: a line, os bolts (bolts-A) ou uma entrega (summit-A); na line, D1=B escolhe outra opção e "D2=…" responde com as suas palavras',
  flags: CLIMB_FLAG,

  run({ projectRoot, args, flags }) {
    const choices = Object.fromEntries(args.map(parseChoice).filter((choice) => choice !== null));
    const target = args.find((arg) => !parseChoice(arg));
    const dir = resolveClimbDir(projectRoot, flags.climb);
    if (!dir) return fail(NO_CLIMB);
    const view = project(readEvents(join(dir, EVENTS_FILE)));
    const lineWaits = view.state === "awaiting_signature" && view.line && !view.line.signed;
    const pending = [...(lineWaits ? [LINE_TARGET] : []), ...view.signatures.filter((s) => !s.signed).map((s) => s.target)];
    const chosen = target ?? pending[0];
    if (!chosen) return fail("nada espera assinatura neste climb");
    if (!pending.includes(chosen)) return fail(`${chosen} não espera assinatura. Pendentes: ${pending.join(", ") || "nenhuma"}`);

    if (Object.keys(choices).length && chosen !== LINE_TARGET) return fail("só a line tem decisões para escolher");
    if (chosen === LINE_TARGET) {
      const { problems, settled } = settle(view.line?.decisions ?? [], choices);
      if (problems.length) return fail(problems.join("; "));
      const hash = signLine(dir, currentUser(), Object.keys(choices).length ? choices : undefined);
      print(`${ink.ok("line assinada")} · ${hash.slice(0, 12)} · ${relative(projectRoot, dir)}`);
      for (const decision of settled.filter((d) => d.by !== "recommended")) print(`  ${decision.id} → ${decision.answer}`);
      return 0;
    }
    const request = view.signatures.find((s) => s.target === chosen)!;
    sign(dir, chosen, request.hash, currentUser());
    print(`${ink.ok(`${chosen} assinado`)} · ${request.hash.slice(0, 12)} · ${request.what}`);
    return 0;
  },
});

export const rescueCommand = defineCommand({
  name: "rescue",
  args: `<${RESCUE_OPTIONS.join("|")}>`,
  summary: "responde o rescue pendente",
  flags: CLIMB_FLAG,

  run({ projectRoot, args, flags }) {
    const option = args[0];
    if (!isRescueOption(option)) return fail(`diga a opção: mohs rescue <${RESCUE_OPTIONS.join("|")}>`);
    const dir = resolveClimbDir(projectRoot, flags.climb);
    if (!dir) return fail(NO_CLIMB);
    answerRescue(dir, option, currentUser());
    print(`${ink.ok("resposta enviada")} · ${option}`);
    return 0;
  },
});
