import type { Diagnostic, RackItem, ResolvedConfig } from "../../config/types.ts";
import { HARDNESS } from "../../domain/types.ts";
import { formatO2 } from "../../util/o2.ts";
import { displayPath } from "../../util/paths.ts";
import { hardnessLabel, ink, print } from "../terminal.ts";

export function printDoctorReport(config: ResolvedConfig): void {
  const shown = (path: string) => displayPath(config.projectRoot, path);
  print(`${ink.bold("MOHs doctor")} · ${config.projectRoot}`, "", ink.bold("camadas"));
  config.layers.forEach((layer, i) => print(`  ${i + 1}  ${layer.label.padEnd(18)} ${ink.dim(layer.kind.padEnd(10))} ${ink.dim(shown(layer.dir))}`));

  print("", `${ink.bold("rack")}  ${config.skills.length} skills · ${config.beta.length} beta · ${config.inspectors.length} inspectors · ${config.checks.length} checks`);
  for (const item of [...config.skills, ...config.beta, ...config.inspectors]) print(itemLine(item));
  for (const check of config.checks) print(`  ${"check".padEnd(9)} ${check.name.padEnd(22)} ${"".padEnd(10)} ${ink.dim(check.layer)}`);

  const { brake, settings } = config;
  const { models, commands } = settings;
  print(
    "",
    `${ink.bold("brake")}  block ${brake.block.join(", ")} · warn ${brake.warn.join(", ") || "—"} · ignore ${brake.ignore.join(", ") || "—"} · confiança ≥ ${brake.minConfidence} · ${brake.fallsBeforeRescue} falls até o rescue`,
    `${ink.bold("models")} setter ${models.setter} · belayer ${models.belayer} · climber ${models.climber} · crux ${models.crux} · inspector ${models.inspector}`,
    `${ink.bold("O₂")}     ${HARDNESS.map((h) => `${hardnessLabel(h)} ${formatO2(settings.hardness[h].o2)}`).join(" · ")}`,
    `${ink.bold("anchor")} ${commands.anchor.join(" · ") || ink.dim("nenhum comando: o Basecamp não terá o que rodar")}`,
    `${ink.bold("send")}   ${commands.send.join(" · ") || ink.dim("nenhum comando")}`,
  );

  print("", ink.bold("diagnósticos"));
  if (!config.diagnostics.length) print(`  ${ink.ok("tudo certo")}`);
  for (const diagnostic of config.diagnostics) print(`  ${diagnosticLine(diagnostic, shown)}`);
}

/** Prints only errors, to stderr. Returns true when there were any. */
export function printConfigErrors(diagnostics: readonly Diagnostic[]): boolean {
  const errors = diagnostics.filter((d) => d.level === "error");
  for (const error of errors) console.error(diagnosticLine(error, (p) => p));
  if (errors.length) console.error(`\nRode ${ink.rope("mohs doctor")} para ver tudo.`);
  return errors.length > 0;
}

function itemLine(item: RackItem): string {
  const target = item.when?.files ? `quando ${item.when.files.join(", ")}` : { always: "sempre", index: "no índice", match: "" }[item.load];
  const replaced = item.replaced.length ? ink.dim(` · substitui ${item.replaced.join(", ")}`) : "";
  return `  ${item.kind.padEnd(9)} ${item.name.padEnd(22)} ${item.roles.join(",").padEnd(10)} ${ink.dim(item.layer.padEnd(14))} ${ink.dim(target)}${replaced}`;
}

function diagnosticLine(diagnostic: Diagnostic, shown: (path: string) => string): string {
  const icon = { error: ink.crit("✗"), warn: ink.warn("!"), info: ink.dim("·") }[diagnostic.level];
  const where = diagnostic.file ? ink.dim(`${shown(diagnostic.file)}${diagnostic.line ? `:${diagnostic.line}` : ""}  `) : "";
  return `${icon} ${where}${diagnostic.message}`;
}
