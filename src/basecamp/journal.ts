import { callSchema, type Call } from "../domain/calls.ts";
import type { EventInput, EventMeta, EventPayloads, EventType, MohsEvent } from "../domain/events.ts";
import type { FrictionKind } from "../domain/types.ts";
import type { EventLog } from "./event-log.ts";

export interface Where {
  route?: string;
  pitch?: number;
  /** Tokens spent by the work that ran into the friction (e.g. an agent that hit its limit). */
  o2?: number;
}

/** Typed front door to the event log: the only way the Basecamp writes what happened. */
export class Journal {
  private readonly log: EventLog;

  constructor(log: EventLog) {
    this.log = log;
  }

  record<K extends EventType>(type: K, data: EventPayloads[K], meta: EventMeta): MohsEvent<K> {
    return this.log.append({ type, data, ...meta } as EventInput<K>);
  }

  /** Validates the call against its schema before it reaches the log. */
  call(call: Call, meta: Omit<EventMeta, "actor"> = {}): void {
    const valid = callSchema.parse(call);
    const route = meta.route ?? ("route" in valid ? valid.route : undefined);
    this.record("call", valid, { ...meta, actor: valid.from, route });
  }

  friction(kind: FrictionKind, detail: string, where: Where = {}): void {
    this.record("friction", { kind, detail }, { actor: "basecamp", ...where });
  }
}
