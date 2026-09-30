import type { CrewDriver } from "../crew/driver.ts";
import { LocalRunner } from "../runner/local-runner.ts";
import { FileBoard } from "./file-board.ts";
import { TaskCrew } from "./task-crew.ts";

/**
 * The default driver: tasks wait as files in the climb folder, and any coding agent (Claude Code,
 * Copilot, a subagent) takes them with `mohs next` and answers with `mohs call`. The checks stay with the Basecamp.
 */
export const agentDriver: CrewDriver = {
  name: "agent",
  summary: "um agente de código pega as tarefas com mohs next e responde com mohs call",

  setup({ config, climbId, climbDir, request }) {
    if (!request) return 'diga o pedido: mohs climb "o que você quer"';
    return {
      crew: new TaskCrew({ config, board: new FileBoard({ climbDir }) }),
      runner: new LocalRunner({ config, climbId }),
      request,
      banner: "equipe: agente pela CLI",
      hint: "No seu agente (Claude Code, Copilot…): mohs next pega a tarefa e mohs call responde. Instruções para ele: mohs agent",
    };
  },
};
