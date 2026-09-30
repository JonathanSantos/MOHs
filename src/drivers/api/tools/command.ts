import { z } from "zod";
import { runShell } from "../../../runner/shell.ts";
import { defineTool } from "../agent/tool.ts";

export const runCommand = defineTool({
  name: "run_command",
  description: "Roda um dos comandos permitidos do projeto (os da anchor e os liberados em tools.commands) na raiz do workspace.",
  input: z.strictObject({ command: z.string().min(1) }),
  access: ({ command }) => ({ kind: "exec", command }),
  async run({ command }, { root, commandTimeoutMs }) {
    const result = await runShell(command, { cwd: root, timeoutMs: commandTimeoutMs });
    const status = result.timedOut ? `tempo esgotado depois de ${Math.round(result.ms / 1000)} s` : `saiu com código ${result.code}`;
    return `${command} ${status}\n${result.output}`;
  },
});
