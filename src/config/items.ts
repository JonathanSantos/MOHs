import { basename, join } from "node:path";
import type { ZodType } from "zod";
import { ROLES, type Hardness, type Role } from "../domain/types.ts";
import { parseFrontmatter } from "../util/frontmatter.ts";
import { isDir, isFile, listDir, readText } from "../util/fs.ts";
import { betaSchema, inspectorSchema, skillSchema } from "./schema.ts";
import { formatPath } from "./yaml.ts";
import type { CheckRef, Diagnostic, ItemKind, LoadMode, RackItem, WhenClause } from "./types.ts";

interface ParsedFrontmatter {
  name?: string;
  description?: string;
  roles?: Role[];
  when?: WhenClause;
  load?: LoadMode;
  priority?: number;
  hardness?: Hardness[];
  model?: string;
  tests?: boolean;
}

/** What differs between skills, beta and inspectors: where they live, their schema and their defaults. */
interface ItemKindSpec {
  folder: string;
  schema: ZodType;
  /** Skills live in `<name>/SKILL.md` (Agent Skills layout); the others are flat `.md` files. */
  layout: "skill-folders" | "flat";
  defaultRoles: readonly Role[];
  defaultLoad(when: WhenClause | undefined): LoadMode;
  defaultHardness?: Hardness[];
}

const ITEM_KINDS: Record<ItemKind, ItemKindSpec> = {
  skill: {
    folder: "rack",
    schema: skillSchema,
    layout: "skill-folders",
    defaultRoles: ["climber"],
    defaultLoad: (when) => (when ? "match" : "index"),
  },
  beta: {
    folder: "beta",
    schema: betaSchema,
    layout: "flat",
    defaultRoles: ROLES,
    defaultLoad: (when) => (when ? "match" : "always"),
  },
  inspector: {
    folder: "inspectors",
    schema: inspectorSchema,
    layout: "flat",
    defaultRoles: ["inspector"],
    defaultLoad: () => "always",
    defaultHardness: ["quartz", "diamond"],
  },
};

interface ReadOptions {
  /** Skills imported from another tool (e.g. .claude/skills): invalid ones are warnings, not errors. */
  lenient?: boolean;
}

export function readLayerItems(layerDir: string, layer: string, diagnostics: Diagnostic[]): RackItem[] {
  return (Object.keys(ITEM_KINDS) as ItemKind[]).flatMap((kind) =>
    readItemsOfKind(kind, join(layerDir, ITEM_KINDS[kind].folder), layer, diagnostics),
  );
}

export function readSkillsFrom(dir: string, layer: string, diagnostics: Diagnostic[]): RackItem[] {
  return readItemsOfKind("skill", dir, layer, diagnostics, { lenient: true });
}

export function readChecks(layerDir: string, layer: string): CheckRef[] {
  const dir = join(layerDir, "checks");
  return listDir(dir)
    .filter((file) => /\.(ts|js)$/.test(file))
    .map((file) => ({ name: file.replace(/\.(ts|js)$/, ""), file: join(dir, file), layer }));
}

function readItemsOfKind(kind: ItemKind, dir: string, layer: string, diagnostics: Diagnostic[], options: ReadOptions = {}): RackItem[] {
  const items: RackItem[] = [];
  for (const { file, fallbackName } of discoverFiles(dir, ITEM_KINDS[kind].layout)) {
    const item = readItem(kind, file, fallbackName, layer, diagnostics, options);
    if (item) items.push(item);
  }
  return items;
}

function discoverFiles(dir: string, layout: ItemKindSpec["layout"]): { file: string; fallbackName: string }[] {
  const found: { file: string; fallbackName: string }[] = [];
  for (const entry of listDir(dir)) {
    const path = join(dir, entry);
    if (layout === "skill-folders" && isDir(path) && isFile(join(path, "SKILL.md"))) {
      found.push({ file: join(path, "SKILL.md"), fallbackName: entry });
    } else if (isFile(path) && entry.endsWith(".md") && entry.toLowerCase() !== "readme.md") {
      found.push({ file: path, fallbackName: basename(entry, ".md") });
    }
  }
  return found;
}

function readItem(
  kind: ItemKind,
  file: string,
  fallbackName: string,
  layer: string,
  diagnostics: Diagnostic[],
  options: ReadOptions,
): RackItem | undefined {
  const spec = ITEM_KINDS[kind];
  const frontmatter = parseFrontmatter(readText(file) ?? "");
  for (const error of frontmatter.errors)
    diagnostics.push({ level: "error", file, line: error.line, message: `frontmatter inválido: ${error.message}` });
  if (frontmatter.errors.length) return undefined;

  const parsed = spec.schema.safeParse(frontmatter.data);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      diagnostics.push({
        level: options.lenient ? "warn" : "error",
        file,
        line: frontmatter.lineOf(issue.path) ?? 2,
        message: `${formatPath(issue.path)}${issue.message}`,
      });
    }
    return undefined;
  }

  const data = parsed.data as ParsedFrontmatter;
  const name = data.name ?? fallbackName;
  if (kind === "skill" && data.name && data.name !== fallbackName) {
    diagnostics.push({
      level: "warn",
      file,
      line: frontmatter.lineOf(["name"]),
      message: `a skill se chama "${data.name}" mas a pasta é "${fallbackName}"`,
    });
  }
  if (!frontmatter.body) diagnostics.push({ level: "warn", file, message: `${kind} "${name}" está sem conteúdo` });

  return {
    kind,
    name,
    description: data.description ?? "",
    roles: data.roles ?? [...spec.defaultRoles],
    when: data.when,
    load: data.load ?? spec.defaultLoad(data.when),
    priority: data.priority ?? 0,
    hardness: spec.defaultHardness ? (data.hardness ?? spec.defaultHardness) : undefined,
    model: data.model,
    tests: kind === "inspector" ? (data.tests ?? false) : undefined,
    body: frontmatter.body,
    file,
    layer,
    replaced: [],
  };
}
