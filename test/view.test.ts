import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { EventPayloads, EventType, MohsEvent } from "../src/domain/events.ts";
import { canClimbTransition, canRouteTransition } from "../src/domain/states.ts";
import { project } from "../src/view/reducer.ts";

function eventFactory() {
  let seq = 0;
  return <K extends EventType>(type: K, data: EventPayloads[K], meta: Partial<Pick<MohsEvent, "route" | "pitch" | "o2">> = {}): MohsEvent =>
    ({
      seq: ++seq,
      ts: new Date(1_700_000_000_000 + seq * 1000).toISOString(),
      climb: "c1",
      type,
      actor: "basecamp",
      data,
      ...meta,
    }) as MohsEvent;
}

const scoutedRoute = {
  id: "A",
  name: "Route",
  hardness: "quartz" as const,
  files: [],
  tags: [],
  budget: 400_000,
  pitches: [
    { title: "p1", files: [] },
    { title: "p2", files: [] },
  ],
};

describe("state machines", () => {
  it("moves the climb forward and resumes it where it was after a rescue", () => {
    assert.ok(canClimbTransition("surveying", "scouting"));
    assert.ok(!canClimbTransition("scouting", "surveying"));
    assert.ok(canClimbTransition("awaiting_signature", "climbing"));
    assert.ok(canClimbTransition("scouting", "climbing"), "talc has no line");
    assert.ok(!canClimbTransition("lining", "climbing"));
    assert.ok(canClimbTransition("climbing", "escalated"));
    assert.ok(!canClimbTransition("escalated", "climbing"));
    assert.ok(canClimbTransition("climbing", "rescue"));
    assert.ok(canClimbTransition("rescue", "climbing", "climbing"));
    assert.ok(!canClimbTransition("rescue", "done", "climbing"));
    assert.ok(!canClimbTransition("done", "rescue"));
  });

  it("sends a fallen route back to pitching and keeps summit final", () => {
    assert.ok(canRouteTransition("sending", "fallen"));
    assert.ok(canRouteTransition("fallen", "pitching"));
    assert.ok(canRouteTransition("inspecting", "blocked"));
    assert.ok(!canRouteTransition("summited", "pitching"));
    assert.ok(!canRouteTransition("planned", "sending"));
  });
});

describe("projection", () => {
  it("rebuilds route position, label and O₂ from events", () => {
    const ev = eventFactory();
    const view = project(
      [
        ev("climb.started", { request: "x", project: "p" }),
        ev("scout.started", {}),
        ev("scout.hardness", { kind: "variation", hardness: "quartz", reason: "", budget: 400_000, routes: [scoutedRoute] }),
        ev("line.started", {}),
        ev("line.drafted", { hash: "h1", text: "# L" }),
        ev("line.signed", { hash: "h1", by: "me" }),
        ev("window.opened", { n: 1, routes: ["A"] }),
        ev("route.started", {}, { route: "A" }),
        ev(
          "pitch.started",
          { title: "p1", crux: false, model: "m", pack: { tokens: 0, skills: [], beta: [], overflow: [] } },
          { route: "A", pitch: 1, o2: 1000 },
        ),
        ev("pitch.anchor", { checks: [] }, { route: "A", pitch: 1 }),
        ev(
          "pitch.started",
          { title: "p2", crux: false, model: "m", pack: { tokens: 0, skills: [], beta: [], overflow: [] } },
          { route: "A", pitch: 2, o2: 2000 },
        ),
        ev("pitch.anchor", { checks: [] }, { route: "A", pitch: 2 }),
        ev("send.started", { attempt: 1, fullSuite: false }, { route: "A" }),
        ev("send.fall", { attempt: 1, failed: 1, total: 3 }, { route: "A" }),
      ],
      true,
    );
    const [route] = view.routes;
    assert.equal(view.state, "climbing");
    assert.equal(route.state, "fallen");
    assert.equal(route.label, "fall");
    assert.equal(route.pos, 1);
    assert.equal(route.o2, 3000);
    assert.equal(view.o2.used, 3000);
    assert.equal(view.falls, 1);
    assert.equal(view.line?.signed, true);
    assert.deepEqual(
      view.timeline.map((t) => t.tag),
      ["scout", "line", "signed", "window"],
    );
  });

  it("throws on an invalid transition in strict mode and records it otherwise", () => {
    const ev = eventFactory();
    const events = [
      ev("climb.started", { request: "x", project: "p" }),
      ev("scout.hardness", { kind: "variation", hardness: "quartz", reason: "", budget: 0, routes: [scoutedRoute] }),
      ev("route.started", {}, { route: "A" }),
      ev("route.summit", { ms: 1 }, { route: "A" }),
      ev("send.started", { attempt: 1, fullSuite: false }, { route: "A" }),
    ];
    assert.throws(() => project(events, true), /transição inválida da route A summited → sending/);
    assert.equal(project(events).errors.length, 1);
  });
});
