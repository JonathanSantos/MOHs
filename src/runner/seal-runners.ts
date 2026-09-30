import { extname } from "node:path";

interface BuiltInRunner {
  extensions: readonly string[];
  command: string;
  /** Survey languages whose projects always have this runtime. */
  languages: readonly string[];
}

/**
 * How a sealed test file runs when the project sets no `commands.seal`: by its extension, with the runtime the stack
 * already has and no dependency. A file passes when its process ends with code 0, so a node:test file and a plain
 * script that exits with an error on a wrong result both work.
 */
const BUILT_IN_RUNNERS: readonly BuiltInRunner[] = [
  {
    extensions: [".js", ".mjs", ".cjs", ".ts", ".mts", ".cts"],
    command: "node --test {file}",
    languages: ["JavaScript", "TypeScript", "JSX", "TSX"],
  },
  { extensions: [".py"], command: "python3 {file}", languages: ["Python"] },
  { extensions: [".sh"], command: "sh {file}", languages: [] },
];

/** The command that runs this file without `commands.seal`, or undefined when no built-in runner takes it. */
export function builtInSealCommand(path: string): string | undefined {
  const extension = extname(path).toLowerCase();
  return BUILT_IN_RUNNERS.find((runner) => runner.extensions.includes(extension))?.command;
}

/** True when a project in these languages can seal without `commands.seal`. An empty project starts in Node. */
export function builtInCovers(languages: readonly string[]): boolean {
  if (!languages.length) return true;
  return BUILT_IN_RUNNERS.some((runner) => runner.languages.some((language) => languages.includes(language)));
}

/** The templates, for whoever may run them (the belayer). */
export function builtInSealCommands(): string[] {
  return BUILT_IN_RUNNERS.map((runner) => runner.command);
}

/** One sentence for agents and people: which files run, and how. */
export function describeBuiltInSeal(): string {
  return BUILT_IN_RUNNERS.map((runner) => `${runner.extensions.join("/")} com ${runner.command.replace("{file}", "<arquivo>")}`).join("; ");
}

/** How each kind of file declares a test case; a file with none (a plain script) is one case. */
const CASE_PATTERNS: readonly { extensions: readonly string[]; pattern: RegExp }[] = [
  {
    extensions: [".js", ".mjs", ".cjs", ".ts", ".mts", ".cts", ".jsx", ".tsx"],
    pattern: /(?:^|[\s;({])(?:it|test)(?:\.(?:only|skip|todo|concurrent|each\b[^(]*\([^)]*\)))?\s*\(/gm,
  },
  { extensions: [".py"], pattern: /^\s*(?:async\s+)?def\s+test_\w*\s*\(/gm },
];

/** Test cases in one file, by the way its language declares them. */
export function countTestCases(path: string, content: string): number {
  const extension = extname(path).toLowerCase();
  const pattern = CASE_PATTERNS.find((candidate) => candidate.extensions.includes(extension))?.pattern;
  return Math.max(1, pattern ? (content.match(pattern) ?? []).length : 1);
}
