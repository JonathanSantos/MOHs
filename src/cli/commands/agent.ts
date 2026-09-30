import { join } from "node:path";
import { CORE_DIR } from "../../config/paths.ts";
import { isPlatform, PLATFORMS } from "../../hooks/output.ts";
import { readText } from "../../util/fs.ts";
import { defineCommand } from "../command.ts";
import { mohsBin } from "../invocation.ts";
import { INSTALLERS } from "../scaffold/agents.ts";
import { fail, ink, print } from "../terminal.ts";

export const AGENT_SKILL = join(CORE_DIR, "agent", "SKILL.md");

export const agentCommand = defineCommand({
  name: "agent",
  args: `[install <${PLATFORMS.join("|")}>]`,
  summary: "mostra as instruções para o agente; com install, instala a skill e os hooks no projeto",
  flags: {},

  run({ projectRoot, args: [action, platform] }) {
    const skill = readText(AGENT_SKILL);
    if (!skill) return fail(`instruções não encontradas em ${AGENT_SKILL}`);
    const bin = mohsBin();
    const text = bin === "mohs" ? skill : `${skill.trimEnd()}\n\nNeste ambiente, \`mohs\` é: \`${bin}\`\n`;
    if (!action) {
      print(text);
      return 0;
    }
    if (action !== "install" || !isPlatform(platform)) return fail(`use: mohs agent install <${PLATFORMS.join("|")}>`);

    let installed;
    try {
      installed = INSTALLERS[platform](projectRoot, bin, text);
    } catch (error) {
      return fail(`não deu para instalar: ${(error as Error).message}`);
    }
    print(`${ink.bold("MOHs")} · agente ${platform}`, "", ...installed.files.map((file) => `  ${ink.ok("escrito")}  ${file}`), "");
    print(
      "Os hooks negam a leitura dos testes selados, protegem .mohs/ e .env durante um climb, deixam os commits com o Basecamp",
      "e não deixam o agente parar com uma tarefa aberta. Fora de um climb, eles não interferem.",
    );
    return 0;
  },
});
