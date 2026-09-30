import { isRole, ROLES } from "../../domain/types.ts";
import { claimTask, readTask, rolesTakenBy } from "../../tasks/file-board.ts";
import { apartFrom, forAgent } from "../../tasks/selection.ts";
import { waitForSituation } from "../../tasks/situation.ts";
import { CLIMB_FLAG, NO_CLIMB, resolveClimbDir, WAIT_FLAG, waitMs } from "../climb-dir.ts";
import { defineCommand } from "../command.ts";
import { reportSituation } from "../reports/situation.ts";
import { fail, print } from "../terminal.ts";

export const nextCommand = defineCommand({
  name: "next",
  summary: "mostra o que o climb precisa agora: a tarefa aberta, a vez do humano ou o fim",
  flags: {
    ...CLIMB_FLAG,
    ...WAIT_FLAG,
    as: { type: "string", placeholder: "nome", description: "quem pede: a tarefa fica com você, e outro agente não a pega" },
    role: { type: "string", placeholder: "papel", description: "só tarefas deste papel, para um subagente por papel" },
    route: { type: "string", placeholder: "id", description: "só tarefas desta route" },
    task: { type: "string", placeholder: "id", description: "mostra esta tarefa" },
    full: { type: "boolean", description: "mostra todas as seções, inclusive as que você já recebeu" },
    json: { type: "boolean", description: "saída em JSON, para hooks e scripts" },
  },

  async run({ projectRoot, flags }) {
    const dir = resolveClimbDir(projectRoot, flags.climb);
    if (!dir) return fail(NO_CLIMB);
    const timeout = waitMs(flags.wait);
    if (typeof timeout === "string") return fail(timeout);
    if (flags.role && !isRole(flags.role)) return fail(`papel desconhecido: ${flags.role}. Papéis: ${ROLES.join(", ")}`);
    const options = { projectRoot, json: flags.json, as: flags.as, full: flags.full, climbDir: dir };
    const took = flags.as ? rolesTakenBy(dir, flags.as) : [];

    if (flags.task) {
      const task = readTask(dir, flags.task);
      if (task?.status !== "open")
        return fail(`a tarefa ${flags.task} não está aberta${task?.answered ? ` (terminou com ${task.answered})` : ""}`);
      if (flags.as && task.claimedBy && task.claimedBy !== flags.as) return fail(`a tarefa ${task.id} está com ${task.claimedBy}`);
      const apart = apartFrom(task.role, took);
      if (apart) return reportSituation({ kind: "apart", tasks: [task], took: apart }, options);
      if (flags.as) claimTask(dir, task.id, flags.as);
      return reportSituation({ kind: "task", task, others: [] }, options);
    }

    const role = isRole(flags.role) ? flags.role : undefined;
    const situation = forAgent(await waitForSituation(dir, timeout), { role, route: flags.route, as: flags.as, took });
    if (situation.kind === "handoff" && (flags.role || flags.route))
      print(
        `Nenhuma tarefa aberta para ${[flags.role, flags.route && `route ${flags.route}`].filter(Boolean).join(" na ")}. Pare aqui e avise quem orquestra.`,
      );
    if (situation.kind === "task" && flags.as) {
      const claim = claimTask(dir, situation.task.id, flags.as);
      // Outro agente pegou a mesma tarefa no mesmo instante: ela é dele.
      if (claim.claimedBy !== flags.as) return reportSituation({ kind: "held", tasks: [{ ...situation.task, ...claim }] }, options);
    }
    return reportSituation(situation, options);
  },
});
