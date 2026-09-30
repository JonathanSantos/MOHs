import { MOHS_SCALE, type Hardness } from "../domain/types.ts";

const colorEnabled = Boolean(process.stdout.isTTY) && !process.env.NO_COLOR;
const paint = (code: string) => (text: string) => (colorEnabled ? `\x1b[${code}m${text}\x1b[0m` : text);

export type Paint = (text: string) => string;

/** Terminal palette, matching the Lookout: rope orange for action, mineral colors for hardness. */
export const ink = {
  rope: paint("38;5;202"),
  dim: paint("2"),
  bold: paint("1"),
  ok: paint("38;5;71"),
  warn: paint("38;5;178"),
  crit: paint("38;5;167"),
  talc: paint("38;5;145"),
  fluorite: paint("38;5;72"),
  quartz: paint("38;5;168"),
  diamond: paint("38;5;38"),
} satisfies Record<string, Paint>;

const LABEL_WIDTH = 9;

export function row(label: string, text: string, tone: Paint = (t) => t): string {
  return `  ${tone(label.padEnd(LABEL_WIDTH))} ${text}`;
}

export function hardnessLabel(hardness: Hardness): string {
  return ink[hardness](`${hardness} ${MOHS_SCALE[hardness]}`);
}

export function print(...lines: string[]): void {
  for (const line of lines) console.log(line);
}

/** Prints the error and returns the exit code, so commands can `return fail(...)`. */
export function fail(message: string): number {
  console.error(`${ink.crit("✗")} ${message}`);
  return 1;
}
