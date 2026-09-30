import { summarizeCall } from "../../domain/calls.ts";
import { findRoute, type HandlerMap } from "../reduction.ts";
import type { FrictionView } from "../types.ts";

const MAX_CALLS = 80;

/** Calls between agents and friction records. */
export const messageHandlers: HandlerMap = {
  call: ({ view, event, data }) => {
    view.calls.push({
      seq: event.seq,
      ts: event.ts,
      call: data.call,
      from: data.from,
      to: data.to,
      route: event.route,
      text: summarizeCall(data),
    });
    if (view.calls.length > MAX_CALLS) view.calls.shift();
  },

  friction: ({ view, event, data }) => {
    const friction: FrictionView = {
      seq: event.seq,
      ts: event.ts,
      kind: data.kind,
      route: event.route,
      pitch: event.pitch,
      detail: data.detail,
    };
    view.friction.push(friction);
    if (event.route) findRoute(view, event.route)?.friction.push(friction);
  },
};
