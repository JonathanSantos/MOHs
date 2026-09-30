import { existsSync } from "node:fs";
import type { LineDecision } from "../domain/decisions.ts";
import { join } from "node:path";
import { CLIMB_FILES, LINE_TARGET, signatureFile } from "../basecamp/desk.ts";
import { EVENTS_FILE, readEvents } from "../basecamp/event-log.ts";
import { basecampAlive } from "../basecamp/presence.ts";
import type { ClimbState } from "../domain/states.ts";
import type { RescueOption, Role } from "../domain/types.ts";
import { sleep } from "../util/runtime.ts";
import { project } from "../view/reducer.ts";
import type { ClimbView } from "../view/types.ts";
import { answerPending, openTasks, readTask, type TaskRecord } from "./file-board.ts";

export type TaskBrief = Pick<TaskRecord, "id" | "role" | "title" | "route" | "claimedBy" | "claimedAt">;

/** What the climb needs right now, from the point of view of whoever drives it through the CLI. */
export type Situation =
  | { kind: "task"; task: TaskRecord; others: TaskRecord[] }
  /** Open tasks that belong to other roles or routes: named, never shown, to whoever asked. */
  | { kind: "handoff"; tasks: TaskBrief[] }
  /** The tasks this agent could take are held by other agents. */
  | { kind: "held"; tasks: TaskBrief[] }
  /** Several open tasks, or a sealed one, for whoever asked without a role: each goes to an agent of its role. */
  | { kind: "board"; tasks: TaskBrief[] }
  /** The tasks this agent asked for belong to a role it may not take after `took` (the belayer never implements). */
  | { kind: "apart"; tasks: TaskBrief[]; took: Role }
  | { kind: "signature"; target: string; what: string; review: string; decisions?: LineDecision[] }
  | { kind: "rescue"; reason: string; options: RescueOption[]; route?: string }
  | { kind: "working"; detail: string }
  | { kind: "done"; view: ClimbView }
  | { kind: "aborted"; reason: string }
  /** A talc fix asked for the full flow; `climb` is the id to start it from. */
  | { kind: "escalated"; reason: string; climb: string }
  | { kind: "stopped" };

const WORK: Partial<Record<ClimbState, string>> = {
  surveying: "mapeando o projeto (survey)",
  scouting: "preparando o plano",
  lining: "preparando a line",
  bolting: "fixando os bolts",
  sealing: "selando os testes",
  climbing: "conduzindo as routes",
  integrating: "juntando as routes na entrega e checando o resultado",
  descending: "fechando o climb (descent)",
};

type Summary<K extends Situation["kind"]> = (situation: Extract<Situation, { kind: K }>) => string;

const SUMMARIES: { [K in Situation["kind"]]: Summary<K> } = {
  task: ({ task }) => `tarefa ${task.id} de ${task.role} aberta`,
  handoff: ({ tasks }) => `tarefa ${tasks[0].id} de ${tasks[0].role} aberta`,
  held: ({ tasks }) => `tarefa ${tasks[0].id} com ${tasks[0].claimedBy}`,
  board: ({ tasks }) => `${tasks.length} tarefa(s) aberta(s)`,
  apart: ({ tasks }) => `tarefa ${tasks[0].id} de ${tasks[0].role} aberta`,
  signature: ({ what }) => `${what.toLowerCase()} espera a assinatura humana`,
  rescue: () => "um rescue espera decisão humana",
  working: ({ detail }) => `o Basecamp está trabalhando: ${detail}`,
  done: () => "o climb terminou",
  aborted: () => "o climb foi interrompido",
  escalated: () => "a correção pediu o fluxo completo",
  stopped: () => "o Basecamp não está rodando",
};

/** One short phrase for where the climb stands, for messages that are not the full report. */
export function summarizeSituation(situation: Situation): string {
  return (SUMMARIES[situation.kind] as (s: Situation) => string)(situation);
}

/** Reads the climb folder: the event log says where the climb is, the task files say what waits for an agent. */
export function readSituation(climbDir: string): Situation {
  const events = readEvents(join(climbDir, EVENTS_FILE));
  const view = project(events);
  if (view.state === "done") return { kind: "done", view };
  if (view.state === "escalated") return { kind: "escalated", reason: view.escalation ?? "motivo não registrado", climb: view.id };
  if (view.state === "aborted") {
    const last = events.findLast((event) => event.type === "climb.aborted");
    return { kind: "aborted", reason: last?.type === "climb.aborted" ? last.data.reason : "motivo não registrado" };
  }

  // Sem o processo do Basecamp ninguém recolhe respostas: uma tarefa aberta não vale mais.
  if (!basecampAlive(climbDir)) return { kind: "stopped" };
  const [task, ...others] = openTasks(climbDir);
  if (task) return { kind: "task", task, others };
  // Uma decisão humana já gravada e ainda não lida pelo Basecamp: a vez já não é do humano.
  if (existsSync(join(climbDir, CLIMB_FILES.signature))) return { kind: "working", detail: "conferindo a assinatura da line" };
  const pending = view.signatures.find((signature) => !signature.signed);
  if (pending && existsSync(signatureFile(climbDir, pending.target))) return { kind: "working", detail: "conferindo a assinatura" };
  if (existsSync(join(climbDir, CLIMB_FILES.rescue))) return { kind: "working", detail: "aplicando a decisão humana" };
  if (view.rescue) return { kind: "rescue", reason: view.rescue.reason, options: view.rescue.options, route: view.rescue.route };
  if (view.state === "awaiting_signature" && !view.line?.signed) {
    if (view.autoSign) return { kind: "working", detail: "assinando a line automaticamente (--auto-sign)" };
    return {
      kind: "signature",
      target: LINE_TARGET,
      what: "A line",
      review: join(climbDir, CLIMB_FILES.line),
      decisions: view.line?.decisions,
    };
  }
  if (pending) {
    if (view.autoSign) return { kind: "working", detail: "assinando automaticamente (--auto-sign)" };
    return { kind: "signature", target: pending.target, what: pending.what, review: pending.review };
  }
  return { kind: "working", detail: describeWork(view) };
}

/** Waits while the Basecamp works (checks, commits, survey) and returns as soon as something needs someone. */
export async function waitForSituation(climbDir: string, timeoutMs: number, pollMs = 250): Promise<Situation> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const situation = readSituation(climbDir);
    if (situation.kind !== "working" || Date.now() >= deadline) return situation;
    await sleep(pollMs);
  }
}

/**
 * After an answer, waits for what comes next for whoever answered. While the Basecamp still works on the answered
 * route for that role (a climber's anchor runs or its route is sent, a belayer's seal is checked), tasks that were
 * already open do not count: the same agent's next task opens in seconds, and it must not stop at someone else's.
 */
export async function waitForNextStep(
  climbDir: string,
  answered: TaskRecord,
  openBefore: ReadonlySet<string>,
  timeoutMs: number,
  pollMs = 250,
): Promise<Situation> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const situation = readSituation(climbDir);
    const settled =
      situation.kind === "task"
        ? [situation.task, ...situation.others].some((task) => !openBefore.has(task.id)) ||
          !stillWorkingFor(project(readEvents(join(climbDir, EVENTS_FILE))), answered)
        : situation.kind !== "working";
    if (settled || Date.now() >= deadline) return situation;
    await sleep(pollMs);
  }
}

/** Whether the Basecamp is still working on what this answer set off, so more work for the same role may follow. */
function stillWorkingFor(view: ClimbView, answered: TaskRecord): boolean {
  const route = view.routes.find((candidate) => candidate.id === answered.route);
  if (!route || route.waitingFor?.length) return false;
  if (answered.role === "climber") return route.state === "pitching" || route.state === "sending";
  if (answered.role === "belayer") return Boolean(route.seal && !route.seal.red) && route.state !== "abandoned";
  return false;
}

export type Pickup = { kind: "accepted" } | { kind: "rejected"; reason: string } | { kind: "pending" } | { kind: "stopped" };

/** Waits for the board to take an answer from the CLI. The task record is final by the time the answer file is gone. */
export async function waitForPickup(climbDir: string, taskId: string, timeoutMs: number, pollMs = 100): Promise<Pickup> {
  const deadline = Date.now() + timeoutMs;
  while (answerPending(climbDir, taskId)) {
    if (!basecampAlive(climbDir)) return { kind: "stopped" };
    if (Date.now() >= deadline) return { kind: "pending" };
    await sleep(pollMs);
  }
  const task = readTask(climbDir, taskId);
  if (task?.status === "open") return { kind: "rejected", reason: task.rejection ?? "resposta recusada" };
  return { kind: "accepted" };
}

function describeWork(view: ClimbView): string {
  const active = view.routes
    .filter((route) => !["planned", "summited", "abandoned"].includes(route.state))
    .map((route) => `route ${route.id}: ${route.label}`);
  const what = WORK[view.state] ?? view.state;
  return active.length ? `${what} (${active.join("; ")})` : what;
}
