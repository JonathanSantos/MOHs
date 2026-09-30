import type { EventPayloads, EventType, MohsEvent } from "../domain/events.ts";
import { canClimbTransition, canRouteTransition, type ClimbState, type RouteState } from "../domain/states.ts";
import type { ClimbView, RouteView } from "./types.ts";

/**
 * What a handler receives: the view, the event, and guarded ways to change state.
 * In strict mode an invalid transition throws (Basecamp and tests); otherwise it is recorded (Lookout).
 */
export class Reduction<K extends EventType = EventType> {
  readonly view: ClimbView;
  readonly event: MohsEvent<K>;
  private readonly strict: boolean;

  constructor(view: ClimbView, event: MohsEvent<K>, strict: boolean) {
    this.view = view;
    this.event = event;
    this.strict = strict;
  }

  get data(): EventPayloads[K] {
    return this.event.data as EventPayloads[K];
  }

  /** The route the event refers to. A missing route is a violation, reported like a bad transition. */
  route(): RouteView | undefined {
    const route = this.event.route ? findRoute(this.view, this.event.route) : undefined;
    if (!route) this.violation(`route desconhecida "${this.event.route}"`);
    return route;
  }

  pitchOf(route: RouteView) {
    return route.pitches[(this.event.pitch ?? 1) - 1];
  }

  moveClimb(to: ClimbState): void {
    if (!canClimbTransition(this.view.state, to, this.view.resumeTo)) {
      this.violation(`transição inválida do climb ${this.view.state} → ${to}`);
    }
    this.view.state = to;
  }

  moveRoute(route: RouteView, to: RouteState): void {
    if (!canRouteTransition(route.state, to)) {
      this.violation(`transição inválida da route ${route.id} ${route.state} → ${to}`);
    }
    route.state = to;
  }

  private violation(message: string): void {
    const full = `#${this.event.seq} ${this.event.type}: ${message}`;
    if (this.strict) throw new Error(full);
    this.view.errors.push(full);
  }
}

export type Handler<K extends EventType> = (r: Reduction<K>) => void;
export type HandlerMap = { [K in EventType]?: Handler<K> };

export function findRoute(view: ClimbView, id: string): RouteView | undefined {
  return view.routes.find((route) => route.id === id);
}

export function topOf(route: RouteView): number {
  return route.pitches.length;
}
