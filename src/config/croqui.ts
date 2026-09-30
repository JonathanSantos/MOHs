import { join } from "node:path";
import { citedFiles, type LoadedCroqui, type SignedCroqui } from "../domain/croqui.ts";
import { readText, sha256 } from "../util/fs.ts";
import type { Diagnostic } from "./types.ts";

export const CROQUI_FILE = "croqui.json";
export const CROQUI_VIEW = "croqui.md";

/** The content hash of each cited file, as it is now; a missing file hashes as empty. */
export function hashCited(projectRoot: string, files: readonly string[]): Record<string, string> {
  return Object.fromEntries(files.map((file) => [file, sha256(readText(join(projectRoot, file)) ?? "")]));
}

/** The signed croqui in `.mohs/`, with the cited files that changed since it was signed. */
export function readCroqui(mohsDir: string, projectRoot: string, diagnostics: Diagnostic[]): LoadedCroqui | undefined {
  const file = join(mohsDir, CROQUI_FILE);
  const text = readText(file);
  if (!text) return undefined;
  try {
    const croqui = JSON.parse(text) as SignedCroqui;
    const now = hashCited(projectRoot, citedFiles(croqui));
    const stale = Object.keys(now).filter((cited) => croqui.cited?.[cited] !== now[cited]);
    return { ...croqui, stale };
  } catch (error) {
    diagnostics.push({ level: "warn", file, message: `croqui ilegível, fica fora dos packs: ${(error as Error).message}` });
    return undefined;
  }
}
