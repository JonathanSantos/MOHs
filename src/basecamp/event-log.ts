import { appendFileSync, closeSync, existsSync, mkdirSync, openSync, readFileSync, readSync, statSync } from "node:fs";
import { join } from "node:path";
import type { EventInput, EventType, MohsEvent } from "../domain/events.ts";
import { isDir, listDir } from "../util/fs.ts";

export type EventListener = (event: MohsEvent) => void;

export const EVENTS_FILE = "events.jsonl";

/** Append-only log of one climb. The source of truth: everything else is a projection of it. */
export class EventLog {
  readonly climb: string;
  readonly file: string;
  private seq: number;
  private readonly listeners = new Set<EventListener>();
  private readonly clock: () => Date;

  constructor(climb: string, dir: string, clock: () => Date = () => new Date()) {
    this.climb = climb;
    this.file = join(dir, EVENTS_FILE);
    this.clock = clock;
    mkdirSync(dir, { recursive: true });
    this.seq = readEvents(this.file).at(-1)?.seq ?? 0;
  }

  append<K extends EventType>(input: EventInput<K>): MohsEvent<K> {
    const event = { seq: ++this.seq, ts: this.clock().toISOString(), climb: this.climb, ...input } as MohsEvent;
    appendFileSync(this.file, `${JSON.stringify(event)}\n`);
    for (const listener of this.listeners) listener(event);
    return event as MohsEvent<K>;
  }

  subscribe(listener: EventListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}

export function readEvents(file: string): MohsEvent[] {
  return existsSync(file) ? parseLines(readFileSync(file, "utf8")) : [];
}

export function climbsDir(mohsDir: string): string {
  return join(mohsDir, "climbs");
}

export function climbDir(mohsDir: string, climbId: string): string {
  return join(climbsDir(mohsDir), climbId);
}

export function listClimbIds(mohsDir: string): string[] {
  return listDir(climbsDir(mohsDir)).filter((id) => isDir(climbDir(mohsDir, id)));
}

/**
 * Follows the event logs of every climb in a project, including those another process is writing.
 * Each poll reads only the bytes appended since the last one; a trailing partial line waits for the next poll.
 */
export function tailClimbs(mohsDir: string, onEvent: EventListener, intervalMs = 200): { stop(): void; poll(): void } {
  const offsets = new Map<string, number>();
  const partialLines = new Map<string, string>();

  const poll = () => {
    for (const id of listClimbIds(mohsDir)) {
      const file = join(climbDir(mohsDir, id), EVENTS_FILE);
      const size = statSync(file, { throwIfNoEntry: false })?.size ?? 0;
      const offset = offsets.get(file) ?? 0;
      if (size <= offset) continue;

      const text = (partialLines.get(file) ?? "") + readRange(file, offset, size);
      offsets.set(file, size);
      const lastBreak = text.lastIndexOf("\n");
      partialLines.set(file, text.slice(lastBreak + 1));
      for (const event of parseLines(text.slice(0, lastBreak + 1))) onEvent(event);
    }
  };

  poll();
  const timer = setInterval(poll, intervalMs);
  timer.unref();
  return { stop: () => clearInterval(timer), poll };
}

function readRange(file: string, start: number, end: number): string {
  const buffer = Buffer.alloc(end - start);
  const fd = openSync(file, "r");
  try {
    readSync(fd, buffer, 0, buffer.length, start);
  } finally {
    closeSync(fd);
  }
  return buffer.toString("utf8");
}

function parseLines(text: string): MohsEvent[] {
  const events: MohsEvent[] = [];
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    try {
      events.push(JSON.parse(line) as MohsEvent);
    } catch {
      // Linha incompleta de uma escrita em andamento: será lida por inteiro na próxima passada.
    }
  }
  return events;
}
