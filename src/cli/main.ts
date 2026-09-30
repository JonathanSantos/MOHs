import { resolve } from "node:path";
import { parseArgs, type ParseArgsOptionsConfig } from "node:util";
import type { Command, FlagSpec, FlagSpecs, FlagValues } from "./command.ts";
import { COMMANDS } from "./commands/index.ts";
import { fail, ink, print } from "./terminal.ts";

const GLOBAL_FLAGS = {
  cwd: { type: "string", placeholder: "pasta", description: "raiz do projeto (padrão: pasta atual)" },
  help: { type: "boolean", short: "h", description: "mostra a ajuda do comando" },
} as const satisfies FlagSpecs;

export async function runCli(argv: readonly string[]): Promise<number> {
  const [name, ...rest] = argv;
  if (!name || name === "help" || name === "--help" || name === "-h") {
    print(generalHelp());
    return 0;
  }
  const command = COMMANDS.find((c) => c.name === name);
  if (!command) return fail(`comando desconhecido: ${name}\n\n${generalHelp()}`);

  let parsed: ReturnType<typeof parseArgs>;
  try {
    parsed = parseArgs({
      args: [...rest],
      allowPositionals: true,
      strict: true,
      options: toParseArgs({ ...GLOBAL_FLAGS, ...command.flags }),
    });
  } catch (error) {
    return fail(`${(error as Error).message}\n\n${commandHelp(command)}`);
  }
  if (parsed.values.help) {
    print(commandHelp(command));
    return 0;
  }
  return command.run({
    projectRoot: resolve(String(parsed.values.cwd ?? process.cwd())),
    args: parsed.positionals,
    flags: parsed.values as FlagValues<FlagSpecs>,
  });
}

function toParseArgs(flags: FlagSpecs): ParseArgsOptionsConfig {
  return Object.fromEntries(
    Object.entries(flags).map(([name, spec]) => [name, spec.short ? { type: spec.type, short: spec.short } : { type: spec.type }]),
  );
}

function generalHelp(): string {
  const width = Math.max(...COMMANDS.map((c) => usage(c).length));
  return [
    `${ink.bold("MOHs")} · My Own Harness System`,
    "",
    "Uso: mohs <comando> [opções]",
    "",
    ...COMMANDS.map((c) => `  ${usage(c).padEnd(width)}   ${c.summary}`),
    "",
    `Ajuda de um comando: mohs <comando> --help. Opções gerais: ${Object.entries(GLOBAL_FLAGS)
      .map(([name, spec]) => flagSignature(name, spec))
      .join(", ")}.`,
  ].join("\n");
}

function commandHelp(command: Command): string {
  const lines = [`Uso: mohs ${usage(command)} [opções]`, "", `  ${command.summary}`];
  const flags = flagLines(command.flags);
  if (flags.length) lines.push("", ...flags);
  lines.push("", ...flagLines(GLOBAL_FLAGS));
  return lines.join("\n");
}

function usage(command: Command): string {
  return command.args ? `${command.name} ${command.args}` : command.name;
}

function flagSignature(name: string, spec: FlagSpec): string {
  return `--${name}${spec.placeholder ? ` ${spec.placeholder}` : ""}`;
}

function flagLines(flags: FlagSpecs): string[] {
  const entries = Object.entries(flags).map(([name, spec]) => [flagSignature(name, spec), spec.description] as const);
  const width = Math.max(0, ...entries.map(([flag]) => flag.length));
  return entries.map(([flag, description]) => `  ${flag.padEnd(width)}   ${description}`);
}
