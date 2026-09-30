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
 * The climb that started last. Ids only go down to the minute, and a fix that escalates opens its full climb in the
 * same minute: sorting ids would leave the choice to the random suffix.
 */
export function latestClimbId(mohsDir: string): string | undefined {
  return listClimbIds(mohsDir)
    .map((id) => ({ id, at: startedAt(mohsDir, id) }))
    .sort((a, b) => a.at - b.at || a.id.localeCompare(b.id))
    .at(-1)?.id;
}

/** The ts of the climb's first event, read from the head of the log; the minute in the id while the log is empty. */
function startedAt(mohsDir: string, id: string): number {
  const file = join(climbDir(mohsDir, id), EVENTS_FILE);
  if (existsSync(file)) {
    const fd = openSync(file, "r");
    const head = Buffer.alloc(256);
    const read = readSync(fd, head, 0, head.length, 0);
    closeSync(fd);
    const ts = /"ts":"([^"]+)"/.exec(head.toString("utf8", 0, read))?.[1];
    if (ts) return Date.parse(ts);
  }
  const [, y, mo, d, h, mi] = /^(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})/.exec(id) ?? [];
  return y ? Date.UTC(+y, +mo - 1, +d, +h, +mi) : 0;
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
