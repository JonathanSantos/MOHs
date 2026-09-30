import { existsSync, mkdirSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { ClimbAborted } from "../basecamp/session.ts";
import type { TaskContext } from "../crew/types.ts";
import type { Role } from "../domain/types.ts";
import { listDir, readText, writeText } from "../util/fs.ts";
import { estimateTokens } from "../util/o2.ts";
import { sleep } from "../util/runtime.ts";
import { parseAnswer, type Answer, type AnswerName } from "./answers.ts";
import type { Task, TaskBoard, TaskResult, TaskSpec } from "./task.ts";

export const TASKS_DIR = "tasks";

/** A task as it sits in the climb folder, with where it stands. */
export interface TaskRecord extends Task {
  status: "open" | "closed";
  /** Why the last answer was refused; the task stays open for another one. */
  rejection?: string;
  answered?: AnswerName;
  closedAt?: string;
  /** The agent that took the task (`--as`), and when. */
  claimedBy?: string;
  claimedAt?: string;
}

export interface FileBoardOptions {
  climbDir: string;
  pollMs?: number;
  /** Stops waiting for answers; the climb ends as aborted. */
  signal?: AbortSignal;
}

const DEFAULT_POLL_MS = 200;

/**
 * Tasks as files in the climb folder, for agents that talk to the Basecamp through the CLI:
 * `mohs next` reads the open task, `mohs call` drops the answer next to it, and the board picks it up.
 * Files work the same on every OS and across processes, like the desk the humans use.
 */
export class FileBoard implements TaskBoard {
  private readonly options: FileBoardOptions;
  private count: number;
  /** Tasks a previous Basecamp of this climb left open: a resumed climb takes them over, with their agents. */
  private readonly inherited: TaskRecord[];

  constructor(options: FileBoardOptions) {
    this.options = options;
    const existing = listTasks(options.climbDir);
    this.count = existing.length;
    this.inherited = existing.filter((task) => task.status === "open");
  }

  async assign<N extends AnswerName>(spec: TaskSpec<N>, _context: TaskContext): Promise<TaskResult<N>> {
    const adopted = this.adopt(spec);
    const task: Task<N> = { ...spec, id: adopted?.id ?? `T${++this.count}`, openedAt: adopted?.openedAt ?? new Date().toISOString() };
    const dir = this.options.climbDir;
    writeRecord(dir, { ...task, status: "open" });

    for (;;) {
      const raw = await this.nextAnswer(task.id);
      const parsed = parseAnswer(task.answers, raw);
      // O registro é gravado antes de apagar a resposta: quem espera pela CLI vê o resultado final assim que ela some.
      if (parsed.ok) writeRecord(dir, { ...task, status: "closed", answered: parsed.answer.call, closedAt: new Date().toISOString() });
      else writeRecord(dir, { ...task, status: "open", rejection: parsed.error });
      unlinkSync(answerFile(dir, task.id));
      // O agente externo não reporta tokens: o O₂ conta o que o MOHs entregou a ele, o pack.
      if (parsed.ok) return { answer: parsed.answer, o2: estimateTokens(task.brief + task.assignment) };
    }
  }

  /**
   * The same task, left open by the Basecamp that stopped: same role, route, pitch and title. It keeps its id, so the
   * agent that holds it (and an answer it dropped meanwhile) carries on.
   */
  private adopt(spec: TaskSpec): TaskRecord | undefined {
    const index = this.inherited.findIndex(
      (task) => task.role === spec.role && task.route === spec.route && task.pitch === spec.pitch && task.title === spec.title,
    );
    return index === -1 ? undefined : this.inherited.splice(index, 1)[0];
  }

  private async nextAnswer(taskId: string): Promise<unknown> {
    const file = answerFile(this.options.climbDir, taskId);
    for (;;) {
      if (this.options.signal?.aborted) throw new ClimbAborted(`interrompido esperando a tarefa ${taskId}`);
      const text = readText(file);
      if (text !== null) {
        try {
          return JSON.parse(text) as unknown;
        } catch {
          // Resposta ainda sendo escrita por outro processo: tenta de novo na próxima volta.
        }
      }
      await sleep(this.options.pollMs ?? DEFAULT_POLL_MS);
    }
  }
}

export function listTasks(climbDir: string): TaskRecord[] {
  return listDir(join(climbDir, TASKS_DIR))
    .filter((name) => /^T\d+\.json$/.test(name))
    .flatMap((name) => {
      try {
        const record = JSON.parse(readText(join(climbDir, TASKS_DIR, name)) ?? "") as TaskRecord;
        return [{ ...record, ...readClaim(climbDir, record.id) }];
      } catch {
        return [];
      }
    })
    .sort((a, b) => Number(a.id.slice(1)) - Number(b.id.slice(1)));
}

export function readTask(climbDir: string, taskId: string): TaskRecord | null {
  return listTasks(climbDir).find((task) => task.id === taskId) ?? null;
}

export function openTasks(climbDir: string): TaskRecord[] {
  return listTasks(climbDir).filter((task) => task.status === "open");
}

/** The roles of every task an agent took in this climb, answered or not. */
export function rolesTakenBy(climbDir: string, agent: string): Role[] {
  return [...new Set(listTasks(climbDir).flatMap((task) => (task.claimedBy === agent ? [task.role] : [])))];
}

/**
 * Takes a task for an agent. The first agent wins: the claim file is created exclusively, so two agents that ask
 * at the same moment never both get it. Returns who holds the task afterwards.
 */
export function claimTask(climbDir: string, taskId: string, by: string): { claimedBy: string; claimedAt: string } {
  const file = claimFile(climbDir, taskId);
  const claim = { claimedBy: by, claimedAt: new Date().toISOString() };
  try {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify(claim), { flag: "wx" });
    return claim;
  } catch {
    return readClaim(climbDir, taskId) ?? claim;
  }
}

function readClaim(climbDir: string, taskId: string): { claimedBy: string; claimedAt: string } | null {
  const text = readText(claimFile(climbDir, taskId));
  if (!text) return null;
  try {
    return JSON.parse(text) as { claimedBy: string; claimedAt: string };
  } catch {
    return null;
  }
}

function claimFile(climbDir: string, taskId: string): string {
  return join(climbDir, TASKS_DIR, `${taskId}.claim.json`);
}

/** Drops an answer for the board. Written to a temporary file and renamed, so the board never reads half of it. */
export function submitAnswer(climbDir: string, taskId: string, answer: Answer): void {
  const file = answerFile(climbDir, taskId);
  writeText(`${file}.tmp`, JSON.stringify({ ...answer, at: new Date().toISOString() }));
  renameSync(`${file}.tmp`, file);
}

/** True while an answer waits for the board to pick it up. */
export function answerPending(climbDir: string, taskId: string): boolean {
  return existsSync(answerFile(climbDir, taskId));
}

function writeRecord(climbDir: string, record: TaskRecord): void {
  writeText(join(climbDir, TASKS_DIR, `${record.id}.json`), JSON.stringify(record, null, 2));
}

function answerFile(climbDir: string, taskId: string): string {
  return join(climbDir, TASKS_DIR, `${taskId}.answer.json`);
}
