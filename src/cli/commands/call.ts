import { readFileSync } from "node:fs";
import { isSoloClimb } from "../../basecamp/resume.ts";
import { join, resolve } from "node:path";
import { EVENTS_FILE, readEvents } from "../../basecamp/event-log.ts";
import type { EventType, MohsEvent } from "../../domain/events.ts";
import { ANSWERS, isAnswerName, parseAnswer, summarizeAnswer, type AnswerName } from "../../tasks/answers.ts";
import { claimTask, openTasks, readTask, rolesTakenBy, submitAnswer, type TaskRecord } from "../../tasks/file-board.ts";
import { apartFrom, forAgent } from "../../tasks/selection.ts";
import { summarizeSituation, waitForNextStep, waitForPickup, waitForSituation } from "../../tasks/situation.ts";
import { CLIMB_FLAG, NO_CLIMB, resolveClimbDir, WAIT_FLAG, waitMs } from "../climb-dir.ts";
import { project } from "../../view/reducer.ts";
import { defineCommand } from "../command.ts";
import { readStdin } from "../stdin.ts";
import { describeEvent } from "../event-lines.ts";
import { reportSituation } from "../reports/situation.ts";
import { fail, ink, print, row } from "../terminal.ts";

const NAMES = Object.keys(ANSWERS).join("|");

export const callCommand = defineCommand({
  name: "call",
  args: `<${NAMES}> [texto]`,
  summary: "responde a tarefa aberta e mostra o próximo passo",
  flags: {
    ...CLIMB_FLAG,
    ...WAIT_FLAG,
    file: {
      type: "string",
      placeholder: "arquivo",
      description: "resposta em arquivo: JSON, ou texto quando a resposta é um texto (- lê da entrada)",
    },
    task: { type: "string", placeholder: "id", description: "tarefa alvo, quando há mais de uma aberta" },
    as: { type: "string", placeholder: "nome", description: "quem responde; a tarefa precisa estar com você (ou livre)" },
    json: { type: "boolean", description: "saída em JSON, para hooks e scripts" },
  },

  async run({ projectRoot, args: [name, ...words], flags }) {
    if (!isAnswerName(name)) return fail(`diga a resposta: mohs call <${NAMES}>`);
    const dir = resolveClimbDir(projectRoot, flags.climb);
    if (!dir) return fail(NO_CLIMB);
    const timeout = waitMs(flags.wait);
    if (typeof timeout === "string") return fail(timeout);

    const task = await pickTask(dir, flags.task, flags.as, timeout);
    if (typeof task === "string") return fail(task);
    if (!(task.answers as readonly string[]).includes(name)) {
      return fail(`a tarefa ${task.id} (${task.role}) termina com: ${task.answers.join(", ")}`);
    }

    const text = words.length ? words.join(" ") : await readAnswer(flags.file);
    if (!text.trim()) return fail(`faltou a resposta: texto, --file <arquivo> ou a entrada padrão`);
    const input = toInput(name, text);
    if (typeof input === "string") return fail(input);
    const parsed = parseAnswer(task.answers, { call: name, input });
    if (!parsed.ok) return fail(`resposta recusada:\n${parsed.error}`);

    const started = Date.now();
    const seenSeq = readEvents(join(dir, EVENTS_FILE)).at(-1)?.seq ?? 0;
    const openBefore = new Set(openTasks(dir).map((open) => open.id));
    submitAnswer(dir, task.id, parsed.answer);
    const pickup = await waitForPickup(dir, task.id, timeout);
    if (pickup.kind === "stopped") return fail("o processo do Basecamp deste climb não está rodando; a resposta ficou guardada");
    if (pickup.kind === "rejected") return fail(`resposta recusada:\n${pickup.reason}`);
    if (pickup.kind === "pending") {
      print(`Resposta entregue para ${task.id}; o Basecamp ainda não a pegou. Rode mohs next em instantes.`);
      return 0;
    }

    // A próxima tarefa só aparece se for do mesmo papel e da mesma route; qualquer outra é só nomeada. Solo, o mesmo
    // agente faz todos os papéis: a próxima aparece, seja de quem for.
    const next = await waitForNextStep(dir, task, openBefore, Math.max(0, timeout - (Date.now() - started)));
    const solo = isSoloClimb(dir);
    const took = flags.as && !solo ? rolesTakenBy(dir, flags.as) : [];
    const situation = forAgent(next, solo ? { as: flags.as, solo } : { role: task.role, route: task.route, as: flags.as, took });
    if (situation.kind === "task" && flags.as) claimTask(dir, situation.task.id, flags.as);
    if (!flags.json) print(`${ink.ok("✓")} ${task.id} · ${name} · ${summarizeAnswer(parsed.answer)}`, ...whatHappened(dir, seenSeq), "");
    return reportSituation(situation, { projectRoot, json: flags.json, as: flags.as, climbDir: dir });
  },
});

/** What the Basecamp did with the answer that the agent should know: checks, commits, friction. */
const AGENT_EVENTS: ReadonlySet<EventType> = new Set([
  "scout.escalated",
  "pitch.anchor",
  "friction",
  "send.clean",
  "send.fall",
  "route.abandoned",
  "repro.red",
  "repro.verified",
  "repro.adopted",
]);

function whatHappened(climbDir: string, afterSeq: number): string[] {
  const events = readEvents(join(climbDir, EVENTS_FILE));
  const view = project(events);
  return events
    .filter((event) => event.seq > afterSeq)
    .flatMap((event): string[] => {
      // A saída de uma anchor que falhou já vem inteira na nova tentativa: aqui basta dizer que falhou.
      if (isFriction(event, "anchor.failed")) return [row("anchor", "falhou; a saída está na nova tentativa abaixo", ink.crit)];
      if (event.type === "friction" && event.data.kind === "crew.note") {
        return [row("nota", `guardada para o descent, que propõe melhorias ao humano: ${event.data.detail}`)];
      }
      if (!AGENT_EVENTS.has(event.type)) return [];
      const line = describeEvent(event, view);
      return line ? [line] : [];
    });
}

function isFriction(event: MohsEvent, kind: string): boolean {
  return event.type === "friction" && event.data.kind === kind;
}

/**
 * The open task to answer. With a name (`--as`), the task must be free or already this agent's; a free one becomes
 * its. Right after a human decision the next task may still be on its way, so this waits for it.
 */
async function pickTask(climbDir: string, id: string | undefined, as: string | undefined, timeoutMs: number): Promise<TaskRecord | string> {
  if (!openTasks(climbDir).length) {
    const situation = await waitForSituation(climbDir, timeoutMs);
    if (situation.kind !== "task")
      return `nenhuma tarefa aberta agora (${summarizeSituation(situation)}); rode mohs next para ver o que o climb precisa`;
  }
  const open = openTasks(climbDir);
  const mine = as ? open.filter((task) => task.claimedBy === as) : [];
  const task = id ? open.find((t) => t.id === id) : mine.length === 1 ? mine[0] : open.length === 1 ? open[0] : undefined;
  if (!task) {
    if (id) return `a tarefa ${id} não está aberta${readTask(climbDir, id)?.answered ? " (já foi respondida)" : ""}`;
    return `há ${open.length} tarefas abertas (${open.map((t) => t.id).join(", ")}): diga qual com --task <id>`;
  }
  if (as && task.claimedBy && task.claimedBy !== as)
    return `a tarefa ${task.id} está com ${task.claimedBy}; pegue a sua com mohs next --as ${as}`;
  const apart = as && !isSoloClimb(climbDir) ? apartFrom(task.role, rolesTakenBy(climbDir, as)) : undefined;
  if (apart) return `${as} já fez tarefa de ${apart} neste climb; a tarefa ${task.id} (${task.role}) precisa de outro agente`;
  if (as) claimTask(climbDir, task.id, as);
  return task;
}

/** From a file (relative to where the command runs, like any CLI) or from the standard input. */
async function readAnswer(file: string | undefined): Promise<string> {
  if (file && file !== "-") return readFileSync(resolve(file), "utf8");
  return readStdin();
}

/** JSON when it looks like JSON; otherwise plain text fills the answer's text field (the summary, the line). */
function toInput(name: AnswerName, text: string): unknown {
  const { textField, example } = ANSWERS[name];
  if (text.trim().startsWith("{")) {
    try {
      return JSON.parse(text) as unknown;
    } catch (error) {
      if (!textField) return `JSON inválido: ${(error as Error).message}`;
    }
  }
  if (textField) return { [textField]: text.trim() };
  return `a resposta ${name} é um JSON, por exemplo: ${JSON.stringify(example)}`;
}
