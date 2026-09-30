import { loadConfig } from "../../config/load.ts";
import { HARDNESS, isHardness, isRole, ROLES } from "../../domain/types.ts";
import { buildPack, renderPack } from "../../pack/build.ts";
import { defineCommand } from "../command.ts";
import { printConfigErrors } from "../reports/doctor.ts";
import { printRackReport } from "../reports/rack.ts";
import { fail, ink, print } from "../terminal.ts";

export const rackCommand = defineCommand({
  name: "rack",
  args: "<papel>",
  summary: "mostra o que entraria no pack de um papel",
  flags: {
    files: { type: "string", placeholder: "a,b", description: "arquivos que o pitch toca" },
    hardness: { type: "string", placeholder: "quartz", description: "talc | fluorite | quartz | diamond (padrão: quartz)" },
    tags: { type: "string", placeholder: "ui,api", description: "tags da line" },
    show: { type: "boolean", description: "imprime o pack completo" },
  },

  run({ projectRoot, args, flags }) {
    const role = args[0] ?? "climber";
    const hardness = flags.hardness ?? "quartz";
    if (!isRole(role)) return fail(`papel desconhecido: ${role}. Use: ${ROLES.join(", ")}`);
    if (!isHardness(hardness)) return fail(`hardness desconhecida: ${hardness}. Use: ${HARDNESS.join(", ")}`);

    const config = loadConfig({ projectRoot });
    printConfigErrors(config.diagnostics);
    const files = splitList(flags.files);
    const pack = buildPack(config, { role, hardness, files, tags: splitList(flags.tags) });
    printRackReport(pack, files);
    if (flags.show) print("", ink.dim("─".repeat(60)), renderPack(pack), "");
    return 0;
  },
});

function splitList(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}
