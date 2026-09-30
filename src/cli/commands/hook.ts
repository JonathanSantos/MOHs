import { join } from "node:path";
import { climbsDir, latestClimbId } from "../../basecamp/event-log.ts";
import { defaultUserDir, mohsDirOf } from "../../config/paths.ts";
import { HOOK_EVENTS, readHookInput, type HookEvent } from "../../hooks/input.ts";
import { contextOutput, isPlatform, PLATFORMS, stopOutput, toolOutput, type Platform } from "../../hooks/output.ts";
import { judgeStop, judgeTool, sessionContext, type GuardState } from "../../hooks/policy.ts";
import { readSituation } from "../../tasks/situation.ts";
import type { TaskRecord } from "../../tasks/file-board.ts";
import { isDir, readText, writeText } from "../../util/fs.ts";
import { canonicalPath } from "../../util/paths.ts";
import { defineCommand } from "../command.ts";
import { readStdin } from "../stdin.ts";
import { print } from "../terminal.ts";

/** After this many blocks for the same open task, the agent may stop: a hook must not trap it in a loop. */
const MAX_STOP_BLOCKS = 3;
const STOPS_FILE = "hook-stops.json";

export const hookCommand = defineCommand({
  name: "hook",
  args: `<${HOOK_EVENTS.join("|")}>`,
  summary: "responde a um hook do Claude Code ou do Copilot (o JSON do hook chega pela entrada padrão)",
  flags: {
    for: { type: "string", placeholder: "plataforma", description: `formato da resposta: ${PLATFORMS.join(" | ")} (padrão: claude)` },
  },

  async run({ projectRoot, args: [event], flags }) {
    const platform: Platform = isPlatform(flags.for) ? flags.for : "claude";
    // Um hook que quebra trava o agente (no Copilot, nega todas as ferramentas): qualquer erro vira "siga em frente".
    try {
      const output = await answer(event as HookEvent, projectRoot, platform);
      if (output) print(JSON.stringify(output));
    } catch (error) {
      // fail-open de propósito; MOHS_DEBUG=1 mostra o erro para quem está investigando o hook.
      if (process.env.MOHS_DEBUG) console.error(error);
    }
    return 0;
  },
});

async function answer(event: HookEvent, projectRoot: string, platform: Platform): Promise<object | null> {
  if (!HOOK_EVENTS.includes(event)) return null;
  const input = readHookInput(parse(await readStdin()), projectRoot);
  const root = findProject([projectRoot, process.env.CLAUDE_PROJECT_DIR, input.cwd]);
  if (!root) return null;
  const climbId = latestClimbId(mohsDirOf(root));
  const climbDir = climbId ? join(climbsDir(mohsDirOf(root)), climbId) : null;
  const situation = climbDir ? readSituation(climbDir) : null;

  if (event === "session-start") return contextOutput(climbId ? sessionContext(climbId, situation) : null, platform);
  if (event === "stop") {
    const verdict = judgeStop(situation);
    if (verdict.allow || !climbDir) return null;
    return countStop(climbDir, verdict.key) <= MAX_STOP_BLOCKS ? stopOutput(verdict, platform) : null;
  }
  if (!input.tool) return null;
  const home = defaultUserDir();
  // Tudo em caminho real: o agente e o MOHs podem enxergar o mesmo arquivo por links diferentes.
  const state: GuardState = {
    projectRoot: canonicalPath(root),
    mohsDir: canonicalPath(mohsDirOf(root)),
    sealsDir: canonicalPath(join(home, "seals")),
    worktreesDir: canonicalPath(join(home, "worktrees")),
    situation: situation?.kind === "task" ? { ...situation, task: real(situation.task), others: situation.others.map(real) } : situation,
  };
  const tool = { ...input.tool, paths: input.tool.paths.map(canonicalPath) };
  const verdict = judgeTool(tool, state);
  // O comando pode citar o seal pelo caminho sem link; a política já olhou o caminho real.
  if (verdict.allow && tool.command?.includes(join(home, "seals")))
    return toolOutput({ allow: false, reason: "os testes selados ficam fora do alcance dos agentes" }, platform);
  return toolOutput(verdict, platform);
}

/** The nearest folder with a `.mohs/`, walking up from each candidate. `~/.mohs` is MOHs' own home, not a project. */
function findProject(candidates: readonly (string | undefined)[]): string | null {
  const home = defaultUserDir();
  for (const start of candidates) {
    for (let dir = start; dir;) {
      const mohs = mohsDirOf(dir);
      if (mohs !== home && isDir(mohs)) return dir;
      const parent = join(dir, "..");
      dir = parent === dir ? undefined : parent;
    }
  }
  return null;
}

function real(task: TaskRecord): TaskRecord {
  return { ...task, cwd: canonicalPath(task.cwd) };
}

function countStop(climbDir: string, key: string): number {
  const file = join(climbDir, STOPS_FILE);
  const counts = (parse(readText(file) ?? "{}") ?? {}) as Record<string, number>;
  counts[key] = (counts[key] ?? 0) + 1;
  writeText(file, JSON.stringify(counts));
  return counts[key];
}

function parse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
