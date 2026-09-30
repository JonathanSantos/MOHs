import { relative } from "node:path";
import { climbsDir } from "../../basecamp/event-log.ts";
import { loadConfig } from "../../config/load.ts";
import { startLookout } from "../../lookout/server.ts";
import { keepAlive } from "../../util/runtime.ts";
import { defineCommand } from "../command.ts";
import { lookoutPort } from "../options.ts";
import { ink, print } from "../terminal.ts";

export const lookoutCommand = defineCommand({
  name: "lookout",
  summary: "sobe só o painel, acompanhando os climbs do projeto",
  flags: {
    port: { type: "string", placeholder: "n", description: "porta do Lookout" },
  },

  async run({ projectRoot, flags }) {
    const config = loadConfig({ projectRoot });
    const lookout = await startLookout({ mohsDir: config.mohsDir, port: lookoutPort(flags.port, config) });
    print(
      `${ink.bold("Lookout")} · ${lookout.url}`,
      `Acompanhando ${relative(process.cwd(), climbsDir(config.mohsDir)) || "."}. Ctrl+C para sair.`,
    );
    return keepAlive();
  },
});
