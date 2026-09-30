import { isTestPath } from "../util/paths.ts";

interface FileDiff {
  path: string;
  status: "novo" | "alterado" | "apagado" | "binário";
  added: number;
  removed: number;
  /** Hunk headers and lines, already numbered with the file's own line numbers. */
  body: string[];
}

export interface ReviewDiffOptions {
  /** Show test files too. Otherwise they are only listed, with their size. */
  tests: boolean;
}

/**
 * A git diff made for review. Each line carries its number in the file as it is in the worktree, so a finding cites
 * `file:line` without searching. Test files are listed with their size unless the reviewer reads tests: most rubrics
 * judge the code, and the tests are often the larger half of the diff.
 */
export function reviewDiff(diff: string, options: ReviewDiffOptions): string {
  const files = parseDiff(diff);
  if (!files.length) return "(sem mudanças)";
  const shown = options.tests ? files : files.filter((file) => !isTestPath(file.path));
  const listed = options.tests ? [] : files.filter((file) => isTestPath(file.path));

  const parts = shown.map((file) => [`### ${file.path} (${file.status} · +${file.added} −${file.removed})`, ...file.body].join("\n"));
  if (!shown.length) parts.push("(só testes mudaram nesta route)");
  if (listed.length) {
    const names = listed.map((file) => `${file.path} (+${file.added} −${file.removed})`).join(", ");
    parts.push(`Testes alterados, fora deste diff (leia no diretório da tarefa se a rubrica pedir): ${names}`);
  }
  return parts.join("\n\n");
}

/** Each file a diff touches, with lines added and removed. */
export function diffStats(diff: string): { path: string; added: number; removed: number }[] {
  return parseDiff(diff).map(({ path, added, removed }) => ({ path, added, removed }));
}

function parseDiff(diff: string): FileDiff[] {
  const files: FileDiff[] = [];
  let file: FileDiff | undefined;
  // Depois do primeiro @@ tudo é conteúdo: uma linha removida "-- comentário" vira "--- comentário" e não é cabeçalho.
  let inHunk = false;
  let next = 0;
  let width = 4;
  for (const line of diff.split("\n")) {
    if (line.startsWith("diff --git ")) {
      // O caminho certo vem no "+++ b/"; o do cabeçalho vale para arquivo binário ou apagado.
      const path = /\s"?b\/(.+?)"?$/.exec(line)?.[1] ?? line.slice(11);
      file = { path: unquote(path), status: "alterado", added: 0, removed: 0, body: [] };
      files.push(file);
      inHunk = false;
      continue;
    }
    if (!file) continue;
    if (line.startsWith("@@")) {
      const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/.exec(line);
      next = Number(hunk?.[1] ?? 1);
      width = Math.max(4, String(next + Number(hunk?.[2] ?? 1)).length);
      inHunk = true;
      if (file.status !== "apagado") file.body.push(line);
    } else if (!inHunk) readHeader(file, line);
    else if (line.startsWith("+")) {
      file.added++;
      file.body.push(`${String(next++).padStart(width)} + ${line.slice(1)}`);
    } else if (line.startsWith("-")) {
      file.removed++;
      if (file.status !== "apagado") file.body.push(`${" ".repeat(width)} - ${line.slice(1)}`);
    } else if (line.startsWith(" ")) {
      file.body.push(`${String(next++).padStart(width)}   ${line.slice(1)}`);
    }
  }
  return files;
}

function readHeader(file: FileDiff, line: string): void {
  if (line.startsWith("new file mode")) file.status = "novo";
  else if (line.startsWith("deleted file mode")) file.status = "apagado";
  else if (line.startsWith("Binary files")) file.status = "binário";
  else if (line.startsWith("+++ ") && !line.endsWith("/dev/null")) file.path = unquote(line.slice(4)).replace(/^b\//, "");
}

/** git quotes paths with unusual characters: "b/caminho com \"aspas\"". */
function unquote(path: string): string {
  const trimmed = path.trim();
  return trimmed.startsWith('"') ? trimmed.slice(1, -1).replace(/\\(.)/g, "$1") : trimmed;
}
