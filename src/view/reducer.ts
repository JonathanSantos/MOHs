import type { EventType, MohsEvent } from "../domain/events.ts";
import { climbHandlers } from "./handlers/climb.ts";
import { messageHandlers } from "./handlers/messages.ts";
import { routeHandlers } from "./handlers/route.ts";
import { findRoute, Reduction, type Handler, type HandlerMap } from "./reduction.ts";
import { appendToTimeline } from "./timeline.ts";
import type { ClimbView } from "./types.ts";

const HANDLERS: HandlerMap = { ...climbHandlers, ...routeHandlers, ...messageHandlers };

export function emptyView(id: string): ClimbView {
  return {
    id,
    request: "",
    project: "",
    state: "surveying",
    startedAt: "",
    updatedAt: "",
    o2: { used: 0, budget: 0 },
    routes: [],
    windows: [],
    calls: [],
    timeline: [],
    friction: [],
    proposals: [],
    signatures: [],
    falls: 0,
    lastSeq: 0,
    errors: [],
  };
}

/** Rebuilds a climb's view from its event log. */
export function project(events: readonly MohsEvent[], strict = false): ClimbView {
  const view = emptyView(events[0]?.climb ?? "");
  for (const event of events) reduce(view, event, strict);
  return view;
}

/** Applies one event to the view (mutating it) and returns the same view. */
export function reduce(view: ClimbView, event: MohsEvent, strict = false): ClimbView {
  view.id ||= event.climb;
  view.updatedAt = event.ts;
  view.lastSeq = event.seq;
  spendO2(view, event);

  const handle = HANDLERS[event.type] as Handler<EventType> | undefined;
  handle?.(new Reduction(view, event, strict));
  appendToTimeline(view, event);
  return view;
}

function spendO2(view: ClimbView, event: MohsEvent): void {
  if (!event.o2) return;
  view.o2.used += event.o2;
  const route = event.route ? findRoute(view, event.route) : undefined;
  if (route) route.o2 += event.o2;
}
