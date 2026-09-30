import type { Pack } from "../../pack/build.ts";
import type { MatchedItem } from "../../rack/select.ts";
import { formatO2 } from "../../util/o2.ts";
import { hardnessLabel, ink, print } from "../terminal.ts";

export function printRackReport(pack: Pack, files: readonly string[]): void {
  const { rack } = pack;
  print(
    `${ink.bold(`rack do ${rack.role}`)} · ${hardnessLabel(pack.hardness)}${files.length ? ` · ${files.join(", ")}` : ""}`,
    `  cota ${formatO2(rack.budget)} · usado ${formatO2(rack.used)}`,
    "",
    `  ${ink.bold("no pack")}`,
  );
  print(...(rack.included.length ? rack.included.map(matchLine) : [`    ${ink.dim("nenhuma skill casou")}`]));
  section(`${ink.bold("no índice")} ${ink.dim("(só nome e descrição)")}`, rack.indexed.map(matchLine));
  section(ink.warn("fora por falta de O₂"), rack.overflow.map(matchLine));
  section(ink.bold("excluídas"), rack.excluded.map((e) => `    ${e.name.padEnd(22)} ${ink.dim(e.reason)}`));
  section(ink.bold("beta"), pack.beta.map((name) => `    ${name}`));

  print("", `${ink.bold("pack")} · ${formatO2(pack.tokens)} tokens ${ink.dim("(estimativa; ordem fixa para cache de prompt)")}`);
  pack.sections.forEach((s, i) => print(`  ${String(i + 1).padStart(2)}  ${s.kind.padEnd(12)} ${s.title.padEnd(42)} ${String(s.tokens).padStart(5)}`));
}

function section(title: string, lines: string[]): void {
  if (lines.length) print(`  ${title}`, ...lines);
}

function matchLine(match: MatchedItem): string {
  return `    ${match.item.name.padEnd(22)} ${String(match.tokens).padStart(5)} tokens  ${ink.dim(match.item.layer.padEnd(14))} ${ink.dim(match.reason)}`;
}
