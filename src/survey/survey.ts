import { readdirSync, statSync } from "node:fs";
import { extname, join, relative } from "node:path";
import type { ClimbKind } from "../domain/types.ts";
import { IGNORED_DIRS, isSecretFile, isTestPath } from "../util/paths.ts";
import { readText } from "../util/fs.ts";
import { normalizePath } from "../util/glob.ts";

export interface SurveyResult {
  kind: ClimbKind;
  files: number;
  /** Short Markdown map of the project, sized to fit a pack. */
  summary: string;
  /** Languages found, most files first. */
  languages?: string[];
  /** Test files the project already has (by name or folder), for how much a passing suite proves. */
  tests?: number;
}

const LANGUAGES: Record<string, string> = {
  ".ts": "TypeScript",
  ".tsx": "TSX",
  ".js": "JavaScript",
  ".jsx": "JSX",
  ".mjs": "JavaScript",
  ".cjs": "JavaScript",
  ".py": "Python",
  ".go": "Go",
  ".rs": "Rust",
  ".java": "Java",
  ".kt": "Kotlin",
  ".rb": "Ruby",
  ".php": "PHP",
  ".cs": "C#",
  ".swift": "Swift",
  ".css": "CSS",
  ".scss": "SCSS",
  ".html": "HTML",
  ".vue": "Vue",
  ".svelte": "Svelte",
  ".sql": "SQL",
};

/** Files that exist in an empty project too; they do not make it a variation. */
const SCAFFOLD_FILES = /^(readme|license|changelog|\.gitignore|\.editorconfig|package(-lock)?\.json|tsconfig.*\.json)/i;

const LIMITS = { maxFiles: 50_000, treeDepth: 2, treeEntries: 40, scripts: 15, dependencies: 25 };

interface PackageJson {
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

/**
 * Maps the repository with code only, so it costs no O₂: languages, layout, scripts and main
 * dependencies. Also decides first ascent versus variation by rule, not by asking a model.
 */
export function surveyRepository(root: string): SurveyResult {
  const files = listProjectFiles(root);
  const sourceFiles = files.filter((file) => !SCAFFOLD_FILES.test(file.split("/").at(-1) ?? ""));
  const kind: ClimbKind = sourceFiles.length > 0 ? "variation" : "first_ascent";
  if (kind === "first_ascent")
    return { kind, files: files.length, summary: "Projeto vazio: via nova (first ascent).", languages: [], tests: 0 };

  const languages = rankLanguages(files);
  const sections = [
    `${files.length} arquivos.${languages.length ? ` Linguagens: ${languages.map(([language, n]) => `${language} ${n}`).join(", ")}.` : ""}`,
    `Estrutura:\n${tree(files)}`,
    ...packageSections(root, files),
  ];
  return {
    kind,
    files: files.length,
    summary: sections.join("\n\n"),
    languages: languages.map(([language]) => language),
    tests: files.filter(isTestPath).length,
  };
}

/** Every project file the survey considers, relative and with `/`: no dependencies, build output or secrets. */
export function listProjectFiles(root: string): string[] {
  const files: string[] = [];
  const stack = [root];
  while (stack.length && files.length < LIMITS.maxFiles) {
    const dir = stack.pop()!;
    for (const name of safeReaddir(dir)) {
      const absolute = join(dir, name);
      const stats = statSync(absolute, { throwIfNoEntry: false });
      if (stats?.isDirectory()) {
        if (!IGNORED_DIRS.has(name)) stack.push(absolute);
      } else if (stats?.isFile() && !isSecretFile(name)) {
        files.push(normalizePath(relative(root, absolute)));
      }
    }
  }
  return files.sort();
}

function rankLanguages(files: string[]): [string, number][] {
  const counts = new Map<string, number>();
  for (const file of files) {
    const language = LANGUAGES[extname(file).toLowerCase()];
    if (language) counts.set(language, (counts.get(language) ?? 0) + 1);
  }
  return [...counts].sort((a, b) => b[1] - a[1]);
}

/** Top two levels with how many files live under each folder. */
function tree(files: string[]): string {
  const counts = new Map<string, number>();
  for (const file of files) {
    const parts = file.split("/");
    for (let depth = 1; depth <= Math.min(LIMITS.treeDepth, parts.length - 1); depth++) {
      const folder = `${parts.slice(0, depth).join("/")}/`;
      counts.set(folder, (counts.get(folder) ?? 0) + 1);
    }
  }
  const lines = [...counts]
    .sort(([a], [b]) => a.localeCompare(b))
    .slice(0, LIMITS.treeEntries)
    .map(([folder, n]) => `${"  ".repeat(folder.split("/").length - 2)}- ${folder} (${n})`);
  const rootFiles = files.filter((file) => !file.includes("/"));
  return [...lines, ...(rootFiles.length ? [`- raiz: ${rootFiles.slice(0, 12).join(", ")}`] : [])].join("\n");
}

function packageSections(root: string, files: string[]): string[] {
  const manifests = files.filter((file) => file.endsWith("package.json") && file.split("/").length <= 2);
  const sections: string[] = [];
  for (const manifest of manifests) {
    const pkg = parsePackage(readText(join(root, manifest)));
    if (!pkg) continue;
    const where = manifest === "package.json" ? "raiz" : manifest.replace(/\/package\.json$/, "");
    const scripts = Object.entries(pkg.scripts ?? {})
      .slice(0, LIMITS.scripts)
      .map(([name, command]) => `  - ${name}: ${command}`);
    const deps = [...Object.keys(pkg.dependencies ?? {}), ...Object.keys(pkg.devDependencies ?? {})].slice(0, LIMITS.dependencies);
    sections.push(
      [
        `package.json (${where})`,
        ...(scripts.length ? ["scripts:", ...scripts] : []),
        ...(deps.length ? [`dependências: ${deps.join(", ")}`] : []),
      ].join("\n"),
    );
  }
  return sections;
}

function parsePackage(text: string | null): PackageJson | null {
  if (!text) return null;
  try {
    return JSON.parse(text) as PackageJson;
  } catch {
    return null;
  }
}

function safeReaddir(dir: string): string[] {
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
}
