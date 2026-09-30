import { isSecretFile, isInside } from "../util/paths.ts";
import type { TaskRecord } from "../tasks/file-board.ts";
import { summarizeSituation, type Situation } from "../tasks/situation.ts";
import type { ToolUse } from "./input.ts";

/** Where things are, and what the climb needs right now. */
export interface GuardState {
  projectRoot: string;
  /** The project's `.mohs/`: agents talk to it through the CLI only. */
  mohsDir: string;
  /** Sealed tests: no agent ever reads them. */
  sealsDir: string;
  /** Route worktrees and throwaway checkouts. */
  worktreesDir: string;
  /** The latest climb's situation; null when the project has no climb. */
  situation: Situation | null;
}

export type Verdict = { allow: true } | { allow: false; reason: string };

const ALLOW = { allow: true } as const;
/** Branches and commits belong to the Basecamp while a climb runs. */
const GIT_WRITES = /\bgit\s+(?:-C\s+\S+\s+)?(commit|checkout|switch|reset|restore|push|merge|rebase|stash|cherry-pick|am|worktree)\b/;

/** True while a Basecamp runs a climb that has not ended. */
const ENDED: readonly Situation["kind"][] = ["done", "aborted", "escalated", "stopped"];

export function climbActive(
  situation: Situation | null,
): situation is Exclude<Situation, { kind: "done" | "aborted" | "escalated" | "stopped" }> {
  return situation !== null && !ENDED.includes(situation.kind);
}

/**
 * The brake for agents MOHs does not run itself (Claude Code, Copilot). Sealed tests are off limits at all times;
 * while a climb runs, `.mohs/` and secrets are too, commits are the Basecamp's, and writes go only where an open
 * task allows. Everything else passes: a hook must never get in the way of work it does not understand.
 */
export function judgeTool(tool: ToolUse, state: GuardState): Verdict {
  const mentions = (dir: string) => tool.paths.some((path) => isInside(dir, path)) || Boolean(tool.command?.includes(dir));
  if (mentions(state.sealsDir)) return deny("os testes selados ficam fora do alcance dos agentes");
  if (!climbActive(state.situation)) return ALLOW;

  if (tool.paths.some((path) => isInside(state.mohsDir, path))) {
    return deny("a pasta .mohs é do MOHs: use mohs next, mohs line e mohs call");
  }
  if (tool.paths.some(isSecretFile)) return deny("arquivos .env não são para agentes durante um climb");

  if (tool.kind === "exec" && tool.command) {
    const git = GIT_WRITES.exec(tool.command);
    if (git) return deny(`git ${git[1]} é com o Basecamp durante um climb: ele faz os commits e as branches`);
  }
  if (tool.kind === "write") return judgeWrite(tool.paths, state);
  return ALLOW;
}

/** Writes inside the project or the worktrees must land in the directory of an open task that writes. */
function judgeWrite(paths: readonly string[], state: GuardState): Verdict {
  const guarded = paths.filter((path) => isInside(state.projectRoot, path) || isInside(state.worktreesDir, path));
  if (!guarded.length) return ALLOW;
  const writable = openTasks(state.situation).filter((task) => task.access === "write");
  if (!writable.length)
    return deny(
      `nenhuma tarefa aberta permite escrever agora (${state.situation ? summarizeSituation(state.situation) : "sem climb"}); rode mohs next`,
    );
  const outside = guarded.filter((path) => !writable.some((task) => isInside(task.cwd, path)));
  if (!outside.length) return ALLOW;
  return deny(`escreva só no diretório da tarefa: ${writable.map((task) => `${task.cwd} (${task.id})`).join(", ")}`);
}

export type StopVerdict = { allow: true } | { allow: false; reason: string; key: string };

/**
 * Keeps an agent from ending its turn while the climb waits on it. The caller counts how often each key blocked,
 * so a stubborn agent is let go instead of looping; human turns and finished climbs always let it stop.
 */
export function judgeStop(situation: Situation | null): StopVerdict {
  if (!situation) return ALLOW;
  if (situation.kind === "task") {
    const { id, role, title } = situation.task;
    return {
      allow: false,
      key: id,
      reason: `Há uma tarefa aberta do MOHs: ${id} (${role}) · ${title}. Termine com o mohs call que ela lista; mohs next mostra de novo.`,
    };
  }
  if (situation.kind === "working") {
    return {
      allow: false,
      key: "working",
      reason: `O Basecamp está trabalhando (${situation.detail}). Rode mohs next para esperar o próximo passo.`,
    };
  }
  return ALLOW;
}

/** One line for a new session: there is a climb, and where it stands. */
export function sessionContext(climbId: string, situation: Situation | null): string | null {
  if (!climbActive(situation)) return null;
  return `MOHs: o climb ${climbId} está em andamento (${summarizeSituation(situation)}). Rode mohs next para ver o que ele precisa; as instruções estão em mohs agent.`;
}

function openTasks(situation: Situation | null): TaskRecord[] {
  return situation?.kind === "task" ? [situation.task, ...situation.others] : [];
}

function deny(reason: string): Verdict {
  return { allow: false, reason };
}
