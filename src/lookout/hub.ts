import type { WebSocket } from "ws";
import { tailClimbs } from "../basecamp/event-log.ts";
import { computeAverages, loadHistory, type Averages } from "../basecamp/metrics.ts";
import type { MohsEvent } from "../domain/events.ts";
import { emptyView, reduce } from "../view/reducer.ts";
import type { ClimbView } from "../view/types.ts";

export type ServerMessage =
  | { type: "hello"; climbs: ClimbView[]; averages: Averages }
  | { type: "event"; event: MohsEvent; view: ClimbView; averages: Averages }
  | { type: "ack"; cmd: string }
  | { type: "error"; message: string };

/** Averages only change when something reaches the summit or ends, so only then are they recomputed. */
const RECOMPUTE_AVERAGES_ON = new Set<MohsEvent["type"]>(["route.summit", "climb.done"]);

/**
 * Follows every climb of the project (including other processes), keeps one projected view per climb
 * and pushes each event, with its updated view, to every connected browser.
 */
export class ClimbHub {
  private readonly mohsDir: string;
  private readonly views = new Map<string, ClimbView>();
  private readonly clients = new Set<WebSocket>();
  private averages: Averages;
  private readonly tail: { stop(): void };

  constructor(mohsDir: string, pollMs: number) {
    this.mohsDir = mohsDir;
    this.averages = computeAverages(loadHistory(mohsDir));
    this.tail = tailClimbs(mohsDir, (event) => this.onEvent(event), pollMs);
  }

  view(climbId: string): ClimbView | undefined {
    return this.views.get(climbId);
  }

  snapshot(): { climbs: ClimbView[]; averages: Averages } {
    return { climbs: [...this.views.values()].sort((a, b) => b.startedAt.localeCompare(a.startedAt)), averages: this.averages };
  }

  connect(client: WebSocket): void {
    this.clients.add(client);
    send(client, { type: "hello", ...this.snapshot() });
    client.on("close", () => this.clients.delete(client));
  }

  close(): void {
    this.tail.stop();
    for (const client of this.clients) client.terminate();
  }

  private onEvent(event: MohsEvent): void {
    const view = this.views.get(event.climb) ?? emptyView(event.climb);
    this.views.set(event.climb, reduce(view, event));
    if (RECOMPUTE_AVERAGES_ON.has(event.type)) this.averages = computeAverages(loadHistory(this.mohsDir));
    for (const client of this.clients) send(client, { type: "event", event, view, averages: this.averages });
  }
}

export function send(client: WebSocket, message: ServerMessage): void {
  if (client.readyState === client.OPEN) client.send(JSON.stringify(message));
}
