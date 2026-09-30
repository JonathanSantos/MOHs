import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import type { ToolUseRecord } from "../crew/types.ts";

export const TRACE_FILE = "trace.jsonl";

export interface TraceEntry extends ToolUseRecord {
  ts: string;
  route?: string;
  pitch?: number;
}

/**
 * High-frequency telemetry (every tool call) lives apart from the event log, which keeps only
 * structural events. Mixing the two is what makes an audit log unreadable.
 */
export class TraceLog {
  readonly file: string;

  constructor(dir: string) {
    mkdirSync(dir, { recursive: true });
    this.file = join(dir, TRACE_FILE);
  }

  append(entry: Omit<TraceEntry, "ts">): void {
    appendFileSync(this.file, `${JSON.stringify({ ts: new Date().toISOString(), ...entry })}\n`);
  }
}
