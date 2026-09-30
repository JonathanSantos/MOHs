import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { buildReport } from "../../report/data.ts";
import { renderReport } from "../../report/html.ts";
import { writeText } from "../../util/fs.ts";
import { displayPath } from "../../util/paths.ts";
import { CLIMB_FLAG, NO_CLIMB, resolveClimbDir } from "../climb-dir.ts";
import { defineCommand } from "../command.ts";
import { fail, ink, print } from "../terminal.ts";

export const reportCommand = defineCommand({
  name: "report",
  summary: "gera um index.html com a linha do tempo, o plano e as decisões de um climb",
  flags: {
    ...CLIMB_FLAG,
    out: { type: "string", placeholder: "arquivo", description: "onde gravar (padrão: index.html na pasta do climb)" },
    title: { type: "string", placeholder: "texto", description: "título da página" },
    annex: { type: "string", placeholder: "arquivo", description: "HTML seu, mostrado logo depois do resumo" },
    fragment: { type: "boolean", description: "só o conteúdo, sem <html>/<head>, para quem embrulha a página" },
  },

  run({ projectRoot, flags }) {
    const dir = resolveClimbDir(projectRoot, flags.climb);
    if (!dir) return fail(NO_CLIMB);
    const annex = flags.annex ? readFileSync(resolve(flags.annex), "utf8") : undefined;
    const html = renderReport(buildReport(dir), { title: flags.title, annex, fragment: flags.fragment });
    const out = flags.out ? resolve(flags.out) : join(dir, "index.html");
    writeText(out, html);
    print(`${ink.ok("relatório")} · ${displayPath(process.cwd(), out)}`);
    return 0;
  },
});
