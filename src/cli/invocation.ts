import { basename } from "node:path";
import { fileURLToPath } from "node:url";

/** The CLI entry point, however MOHs was started (installed bin, `node src/cli.ts`, tests). */
export const CLI_ENTRY = fileURLToPath(new URL("../cli.ts", import.meta.url));

/**
 * How to call MOHs again, for commands printed to agents: `mohs` when installed, or the exact
 * `node …/cli.ts` otherwise, so a printed command always runs as is. `MOHS_BIN` overrides both.
 */
export function mohsBin(): string {
  if (process.env.MOHS_BIN) return process.env.MOHS_BIN;
  return basename(process.argv[1] ?? "", ".js") === "mohs" ? "mohs" : `node ${quote(CLI_ENTRY)}`;
}

/** Double quotes work the same in bash, zsh, cmd and PowerShell for paths and plain text. */
export function quote(arg: string): string {
  return /^[\w./:@%+=,-]+$/.test(arg) ? arg : `"${arg.replace(/(["\\$`])/g, "\\$1")}"`;
}
