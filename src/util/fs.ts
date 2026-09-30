import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

export function isDir(path: string): boolean {
  return statSync(path, { throwIfNoEntry: false })?.isDirectory() ?? false;
}

export function isFile(path: string): boolean {
  return statSync(path, { throwIfNoEntry: false })?.isFile() ?? false;
}

export function readText(path: string): string | null {
  return existsSync(path) ? readFileSync(path, "utf8") : null;
}

export function listDir(path: string): string[] {
  return isDir(path) ? readdirSync(path).sort() : [];
}

export function writeText(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
}

/** Writes several files at once, e.g. `{ "rack/a/SKILL.md": "..." }`. Keys use `/` on every platform. */
export function writeTree(root: string, files: Record<string, string>): void {
  for (const [relativePath, content] of Object.entries(files)) {
    writeText(join(root, ...relativePath.split("/")), content);
  }
}

export function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}
