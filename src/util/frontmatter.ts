import { LineCounter, parseDocument } from "yaml";

export interface Frontmatter {
  data: Record<string, unknown>;
  body: string;
  errors: { line: number; message: string }[];
  /** File line where the value at `path` starts, to point schema errors at the right place. */
  lineOf(path: readonly PropertyKey[]): number | undefined;
}

const FENCE = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/;

/** The YAML block starts on line 2 of the file, right after the opening `---`. */
const FIRST_YAML_LINE = 2;

export function parseFrontmatter(source: string): Frontmatter {
  const fence = source.match(FENCE);
  if (!fence) return { data: {}, body: source.trim(), errors: [], lineOf: () => undefined };

  const lines = new LineCounter();
  const doc = parseDocument(fence[1], { lineCounter: lines });
  const toFileLine = (yamlLine: number) => yamlLine + FIRST_YAML_LINE - 1;
  const parsed: unknown = doc.toJS();

  return {
    data: isPlainObject(parsed) ? parsed : {},
    body: source.slice(fence[0].length).trim(),
    errors: doc.errors.map((e) => ({ line: toFileLine(e.linePos?.[0]?.line ?? 1), message: e.message.split("\n")[0] })),
    lineOf(path) {
      const node = doc.getIn(path as (string | number)[], true) as { range?: [number, number, number] } | undefined;
      return node?.range ? toFileLine(lines.linePos(node.range[0]).line) : undefined;
    },
  };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
