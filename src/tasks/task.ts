import type { TaskContext } from "../crew/types.ts";
import type { Role } from "../domain/types.ts";
import type { Answer, AnswerName } from "./answers.ts";

/**
 * One unit of crew work, described so that any agent can do it: our own loop over a model API,
 * Claude Code, Copilot or a subagent. Everything the agent needs is here; nothing depends on who it is.
 */
export interface TaskSpec<N extends AnswerName = AnswerName> {
  role: Role;
  /** One line that says what the task is, e.g. "Pitch 1 de 2 da route A (Saudação): …". */
  title: string;
  route?: string;
  pitch?: number;
  attempt?: number;
  /** The crux pitch can run on a stronger model. */
  crux?: boolean;
  /** Where the agent works: the project root for planning roles, the route's worktree for the climber. */
  cwd: string;
  branch?: string;
  /** Planning roles only read; the climber writes inside `cwd`. */
  access: "read" | "write";
  /** Stable context, the same across tasks of a role: cacheable. */
  brief: string;
  /** What changes from one task to the next: the task itself and feedback from the last attempt. */
  assignment: string;
  answers: readonly N[];
  /** Commands the agent may run. */
  commands: readonly string[];
  /** Commands the Basecamp runs by itself once the task ends. The agent never reports them as passed. */
  checks: readonly string[];
  /** Files the task is expected to create or change. */
  files: readonly string[];
}

export interface Task<N extends AnswerName = AnswerName> extends TaskSpec<N> {
  id: string;
  openedAt: string;
}

export interface TaskResult<N extends AnswerName = AnswerName> {
  answer: Answer<N>;
  /** Tokens the work cost, when the board can tell. */
  o2: number;
}

/**
 * Where tasks go to be done. The Basecamp does not know who does them: an agent reading the CLI
 * (FileBoard), our own loop over a model API (drivers/api) or a script in tests.
 */
export interface TaskBoard {
  assign<N extends AnswerName>(task: TaskSpec<N>, context: TaskContext): Promise<TaskResult<N>>;
}
