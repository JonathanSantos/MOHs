import { LineCounter, parseDocument } from "yaml";
import type { ZodType } from "zod";
import { readText } from "../util/fs.ts";
import type { Diagnostic } from "./types.ts";

type YamlDocument = ReturnType<typeof parseDocument>;
type Ranged = { range?: [number, number, number] };
type Path = (string | number)[];

/**
 * Reads and validates a YAML file. Every problem becomes a diagnostic pointing at file and line,
 * and an invalid file contributes nothing (returns undefined) instead of half a config.
 */
export function readYamlFile<T>(file: string, schema: ZodType<T>, diagnostics: Diagnostic[]): T | undefined {
  const text = readText(file);
  if (text === null) return undefined;

  const lines = new LineCounter();
  const doc = parseDocument(text, { lineCounter: lines });
  if (doc.errors.length) {
    for (const error of doc.errors) {
      diagnostics.push({ level: "error", file, line: error.linePos?.[0]?.line, message: `YAML inválido: ${error.message.split("\n")[0]}` });
    }
    return undefined;
  }

  const result = schema.safeParse(doc.toJS() ?? {});
  if (result.success) return result.data;

  for (const issue of result.error.issues) {
    const unknownKey = issue.code === "unrecognized_keys" ? issue.keys[0] : undefined;
    const path = (unknownKey ? [...issue.path, unknownKey] : issue.path) as Path;
    const offset = unknownKey ? keyOffset(doc, issue.path as Path, unknownKey) : valueOffset(doc, path);
    diagnostics.push({
      level: "error",
      file,
      line: offset === undefined ? undefined : lines.linePos(offset).line,
      message: `${formatPath(path)}${issue.message}`,
    });
  }
  return undefined;
}

export function formatPath(path: readonly PropertyKey[]): string {
  return path.length ? `${path.map(String).join(".")}: ` : "";
}

function valueOffset(doc: YamlDocument, path: Path): number | undefined {
  return (doc.getIn(path, true) as Ranged | undefined)?.range?.[0];
}

/** Offset of the key itself (not its value), so an unknown key is reported on its own line. */
function keyOffset(doc: YamlDocument, parent: Path, key: string): number | undefined {
  const map = (parent.length ? doc.getIn(parent, true) : doc.contents) as { items?: { key?: Ranged & { value?: unknown } }[] } | null;
  const pair = map?.items?.find((item) => item.key?.value === key);
  return pair?.key?.range?.[0] ?? valueOffset(doc, [...parent, key]);
}
