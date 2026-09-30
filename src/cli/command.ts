export interface FlagSpec {
  type: "string" | "boolean";
  description: string;
  /** Shown in help next to string flags, e.g. `<nome>`. */
  placeholder?: string;
  short?: string;
}

export type FlagSpecs = Record<string, FlagSpec>;

type FlagValue<S extends FlagSpec> = S["type"] extends "boolean" ? boolean | undefined : string | undefined;

export type FlagValues<F extends FlagSpecs> = { [K in keyof F]: FlagValue<F[K]> };

export interface CommandContext<F extends FlagSpecs> {
  projectRoot: string;
  args: string[];
  flags: FlagValues<F>;
}

/** One CLI command. The help text and the argument parser are both generated from this. */
export interface Command<F extends FlagSpecs = FlagSpecs> {
  name: string;
  /** Positional part of the usage line, e.g. `"<papel>"`. */
  args?: string;
  summary: string;
  flags: F;
  run(context: CommandContext<F>): Promise<number> | number;
}

/** Identity helper that keeps each command's flags precisely typed inside `run`. */
export function defineCommand<const F extends FlagSpecs>(command: Command<F>): Command<F> {
  return command;
}
