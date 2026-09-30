import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { z } from "zod";
import { defineTool, ToolFailure } from "../agent/tool.ts";
import { matchGlob, normalizePath } from "../../../util/glob.ts";
import { IGNORED_DIRS, isSecretFile } from "../../../util/paths.ts";
import { resolveInside } from "./paths.ts";

const LIMITS = { listEntries: 300, readLines: 400, searchMatches: 60, searchFileBytes: 1_000_000, lineChars: 300 };

export const listFiles = defineTool({
  name: "list_files",
  description: "Lista arquivos e pastas a partir de um caminho do workspace, até a profundidade pedida. Pastas terminam com /.",
  input: z.strictObject({
    path: z.string().default(".").describe("pasta relativa à raiz do workspace"),
    depth: z.number().int().min(1).max(6).default(2),
  }),
  access: ({ path }, { root }) => ({ kind: "read", paths: [resolveInside(root, path).absolute] }),
  async run({ path, depth }, { root }) {
    const start = resolveInside(root, path);
    if (!existsSync(start.absolute)) throw new ToolFailure(`"${path}" não existe`);
    const entries: string[] = [];
    walk(start.absolute, depth, (absolute, isDirectory) => {
      entries.push(`${normalizePath(absolute.slice(root.length + 1))}${isDirectory ? "/" : ""}`);
      return entries.length < LIMITS.listEntries;
    });
    const cut = entries.length >= LIMITS.listEntries ? `\n…(lista cortada em ${LIMITS.listEntries})` : "";
    return entries.length ? entries.join("\n") + cut : "(vazio)";
  },
});

export const readFile = defineTool({
  name: "read_file",
  description: "Lê um arquivo de texto do workspace, com números de linha. Use offset e limit para arquivos grandes.",
  input: z.strictObject({
    path: z.string(),
    offset: z.number().int().min(1).default(1).describe("primeira linha (começa em 1)"),
    limit: z.number().int().min(1).max(2000).default(LIMITS.readLines),
  }),
  access: ({ path }, { root }) => ({ kind: "read", paths: [resolveInside(root, path).absolute] }),
  async run({ path, offset, limit }, { root }) {
    const file = resolveInside(root, path);
    if (!existsSync(file.absolute) || statSync(file.absolute).isDirectory()) throw new ToolFailure(`"${path}" não é um arquivo`);
    const lines = readFileSync(file.absolute, "utf8").split("\n");
    const slice = lines.slice(offset - 1, offset - 1 + limit);
    const numbered = slice.map((line, i) => `${String(offset + i).padStart(5)}  ${line}`).join("\n");
    const remaining = lines.length - (offset - 1 + slice.length);
    return remaining > 0 ? `${numbered}\n…(mais ${remaining} linhas; use offset ${offset + slice.length})` : numbered;
  },
});

export const searchFiles = defineTool({
  name: "search",
  description: "Procura uma expressão regular nos arquivos de texto do workspace e devolve arquivo:linha: trecho.",
  input: z.strictObject({
    pattern: z.string().min(1).describe("expressão regular (sintaxe JavaScript)"),
    glob: z.string().optional().describe("filtra arquivos, ex.: web/src/**/*.tsx"),
  }),
  access: (_input, { root }) => ({ kind: "read", paths: [root] }),
  async run({ pattern, glob }, { root }) {
    let regexp: RegExp;
    try {
      regexp = new RegExp(pattern);
    } catch (error) {
      throw new ToolFailure(`expressão regular inválida: ${(error as Error).message}`);
    }
    const matches: string[] = [];
    walk(root, 12, (absolute, isDirectory) => {
      if (isDirectory) return true;
      const rel = normalizePath(absolute.slice(root.length + 1));
      if (glob && !matchGlob(rel, glob)) return true;
      if (statSync(absolute).size > LIMITS.searchFileBytes) return true;
      const text = readFileSync(absolute, "utf8");
      if (text.includes("\u0000")) return true;
      text.split("\n").forEach((line, i) => {
        if (matches.length < LIMITS.searchMatches && regexp.test(line))
          matches.push(`${rel}:${i + 1}: ${line.trim().slice(0, LIMITS.lineChars)}`);
      });
      return matches.length < LIMITS.searchMatches;
    });
    return matches.length ? matches.join("\n") : "nenhuma ocorrência";
  },
});

export const writeFile = defineTool({
  name: "write_file",
  description: "Cria ou substitui um arquivo inteiro. Para mudar parte de um arquivo existente, prefira edit_file.",
  input: z.strictObject({ path: z.string(), content: z.string() }),
  access: ({ path }, { root }) => ({ kind: "write", paths: [resolveInside(root, path).absolute] }),
  async run({ path, content }, { root }) {
    const file = resolveInside(root, path);
    mkdirSync(dirname(file.absolute), { recursive: true });
    writeFileSync(file.absolute, content);
    return `${file.relative} escrito (${content.split("\n").length} linhas)`;
  },
});

export const editFile = defineTool({
  name: "edit_file",
  description:
    "Troca um trecho exato de um arquivo por outro. O trecho `old` precisa aparecer uma única vez, a menos que replace_all seja true.",
  input: z.strictObject({
    path: z.string(),
    old: z.string().min(1).describe("texto atual, copiado exatamente, com indentação"),
    new: z.string(),
    replace_all: z.boolean().default(false),
  }),
  access: ({ path }, { root }) => ({ kind: "write", paths: [resolveInside(root, path).absolute] }),
  async run({ path, old, new: replacement, replace_all }, { root }) {
    const file = resolveInside(root, path);
    if (!existsSync(file.absolute)) throw new ToolFailure(`"${path}" não existe; para criar, use write_file`);
    const text = readFileSync(file.absolute, "utf8");
    const count = text.split(old).length - 1;
    if (count === 0) throw new ToolFailure("o trecho `old` não foi encontrado; leia o arquivo de novo e copie o texto exato");
    if (count > 1 && !replace_all) throw new ToolFailure(`o trecho aparece ${count} vezes; inclua mais contexto ou use replace_all`);
    writeFileSync(file.absolute, replace_all ? text.split(old).join(replacement) : text.replace(old, () => replacement));
    return `${file.relative} editado (${replace_all ? count : 1} troca${count > 1 && replace_all ? "s" : ""})`;
  },
});

/** Depth-first walk that skips ignored folders; `visit` returns false to stop early. */
function walk(start: string, maxDepth: number, visit: (absolute: string, isDirectory: boolean) => boolean): void {
  const stack: { dir: string; depth: number }[] = [{ dir: start, depth: 0 }];
  while (stack.length) {
    const { dir, depth } = stack.pop()!;
    let names: string[];
    try {
      names = readdirSync(dir).sort().reverse();
    } catch {
      continue;
    }
    for (const name of names) {
      const absolute = join(dir, name);
      const isDirectory = statSync(absolute, { throwIfNoEntry: false })?.isDirectory() ?? false;
      if (isDirectory ? IGNORED_DIRS.has(name) : isSecretFile(name)) continue;
      if (!visit(absolute, isDirectory)) return;
      if (isDirectory && depth + 1 < maxDepth) stack.push({ dir: absolute, depth: depth + 1 });
    }
  }
}
