import { join } from "node:path";
import { readText, writeText } from "../util/fs.ts";

const PRESENCE_FILE = "basecamp.json";

/** Records which process runs this climb, so the CLI can tell a busy Basecamp from a dead one. */
export function announceBasecamp(climbDir: string): void {
  writeText(join(climbDir, PRESENCE_FILE), JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }));
}

export function basecampAlive(climbDir: string): boolean {
  const text = readText(join(climbDir, PRESENCE_FILE));
  if (!text) return false;
  try {
    const { pid } = JSON.parse(text) as { pid?: number };
    if (!pid) return false;
    // Sinal 0 só pergunta se o processo existe; funciona igual no Windows, macOS e Linux.
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}
