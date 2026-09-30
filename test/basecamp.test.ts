import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { CLIMB_FILES, FileDesk, type Desk } from "../src/basecamp/desk.ts";
import { readEvents } from "../src/basecamp/event-log.ts";
import { getScenario, type Scenario } from "../src/drivers/fake/scenarios/index.ts";
import type { MohsEvent } from "../src/domain/events.ts";
import { findLeaks } from "../src/guards/leak.ts";
import { sha256, writeText } from "../src/util/fs.ts";
import { project } from "../src/view/reducer.ts";
import type { PlannedRoute } from "../src/domain/plan.ts";
import { FakeCrew } from "../src/drivers/fake/fake-crew.ts";
import { simulatedClimb } from "./helpers.ts";

const shareLink = getScenario("share-link");
const quickFix = getScenario("quick-fix");

const frictionKinds = (events: MohsEvent[]) => events.flatMap((e) => (e.type === "friction" ? [e.data.kind] : []));
const calls = (events: MohsEvent[]) => events.flatMap((e) => (e.type === "call" ? [e.data] : []));

describe("share-link climb (simulated)", () => {
  it("summits all three routes through a fall, a security block and the descent", async () => {
    const climb = simulatedClimb(shareLink);
    const view = await climb.run();
    const events = readEvents(climb.logFile);

    assert.equal(view.state, "done");
    assert.deepEqual(
      view.routes.map((r) => r.state),
      ["summited", "summited", "summited"],
    );
    assert.equal(view.falls, 1);
    for (const kind of ["brake.denied", "env", "send.fall", "leak.blocked", "inspection.blocked"]) {
      assert.ok(frictionKinds(events).includes(kind as never), `missing friction ${kind}`);
    }
    assert.equal(view.proposals.length, 2);
    const blocking = view.routes[0].findings.filter((f) => f.action === "block");
    assert.equal(blocking.length, 1);
    assert.equal(blocking[0].fixed, true);
    assert.ok(view.o2.used > 0 && view.o2.used < view.o2.budget);
  });

  it("replays the log from disk into exactly the same view", async () => {
    const climb = simulatedClimb(shareLink);
    const view = await climb.run();
    assert.deepEqual(project(readEvents(climb.logFile), true), view);
  });

  it("never hands the climber a FALL that quotes the sealed tests", async () => {
    const climb = simulatedClimb(shareLink);
    await climb.run();
    const falls = calls(readEvents(climb.logFile)).filter((c) => c.call === "FALL");
    assert.ok(falls.length > 0);
    for (const fall of falls) {
      if (fall.call !== "FALL") continue;
      for (const route of shareLink.routes)
        assert.deepEqual(findLeaks(`${fall.scenario} ${fall.expected} ${fall.actual}`, route.seal?.code ?? ""), []);
    }
  });

  it("packs the rack skills that match each pitch's files", async () => {
    const climb = simulatedClimb(shareLink);
    await climb.run();
    const skillsOf = (route: string, pitch: number) => {
      const started = readEvents(climb.logFile).find((e) => e.type === "pitch.started" && e.route === route && e.pitch === pitch);
      return started?.type === "pitch.started" ? started.data.pack.skills : [];
    };
    assert.deepEqual(skillsOf("A", 2), ["fastify-route"]);
    assert.deepEqual(skillsOf("B", 2), ["react-component"]);
    assert.deepEqual(skillsOf("B", 1), []);
  });

  it("records pack.overflow when skills exceed the role's O₂ budget", async () => {
    const climb = simulatedClimb(shareLink, { overrides: { rack: { climber: { o2: 50 } } } });
    await climb.run();
    assert.ok(frictionKinds(readEvents(climb.logFile)).includes("pack.overflow"));
  });

  it("validates every call against its schema", async () => {
    const climb = simulatedClimb(shareLink);
    await climb.run();
    const recorded = calls(readEvents(climb.logFile));
    assert.deepEqual([...new Set(recorded.map((c) => c.call))].sort(), ["CLIMB", "FALL", "ROCK", "SAFE"]);
    for (const call of recorded) if (call.call === "SAFE") assert.ok(call.summary.length <= 280);
  });
});

describe("Basecamp rules", () => {
  it("surveys first, then takes fluorite straight to the summit: no bolts, seal, inspection or descent", async () => {
    const climb = simulatedClimb(quickFix, { overrides: { commands: { anchor: ["npm run lint", "npm test"] } } });
    const view = await climb.run();
    const events = readEvents(climb.logFile);
    const types = new Set(events.map((e) => e.type));
    assert.equal(view.state, "done");
    assert.deepEqual(
      events.slice(0, 3).map((e) => e.type),
      ["climb.started", "survey.started", "survey.ready"],
    );
    for (const skipped of ["bolts.started", "seal.started", "send.started", "inspection.started", "descent.started"] as const) {
      assert.ok(!types.has(skipped), `should not have ${skipped}`);
    }
    assert.equal(view.routes[0].state, "summited");
    assert.equal(view.routes[0].evidence?.grade, "média", "fluorite with the project's tests and no seal");
    assert.deepEqual(view.routes[0].evidence?.proofs, ["testes do projeto (npm test)", "checagens sem teste (npm run lint)"]);
  });

  it("rigs each route on its own: a fluorite route climbs while another route's belayer still writes tests", async () => {
    let fluoriteClimbing!: () => void;
    const climbing = new Promise<void>((resolve) => (fluoriteClimbing = resolve));
    // O belayer da A só termina depois que o climber da C começou: no rigging antigo, de todas as routes antes da
    // primeira subida, este climb nunca terminaria.
    class SlowBelayer extends FakeCrew {
      override async seal(route: PlannedRoute) {
        if (route.id === "A") await climbing;
        return super.seal(route);
      }
      override async climbPitch(route: PlannedRoute, pitch: number) {
        if (route.id === "C") fluoriteClimbing();
        return super.climbPitch(route, pitch);
      }
    }
    const climb = simulatedClimb(shareLink, { crew: new SlowBelayer(shareLink, Infinity) });
    const view = await climb.run();
    const events = readEvents(climb.logFile);
    const at = (type: string, route: string) => events.findIndex((e) => e.type === type && e.route === route);

    assert.equal(view.state, "done", JSON.stringify(view.errors));
    assert.ok(at("route.started", "C") < at("seal.red", "A"), "C started before A's seal was done");
    assert.ok(at("bolts.started", "B") < at("bolts.set", "A"), "setters of different routes work at the same time");
    assert.ok(view.routes.every((route) => route.state === "summited"));
  });

  it("accepts a signature only for the line's current text", async () => {
    const EDITED = "# Edited line\n\nQUANDO algo ENTÃO outra coisa.\n";
    let asks = 0;
    const desk: Desk = {
      async waitForSignature(dir) {
        const file = join(dir, CLIMB_FILES.line);
        const hashNow = sha256(readFileSync(file, "utf8"));
        if (++asks === 1) writeText(file, EDITED); // someone edits the line, then signs the old text
        return { hash: hashNow, by: "me" };
      },
      waitForRescue: async () => "retry",
    };
    const climb = simulatedClimb(quickFix, { desk });
    const view = await climb.run();
    const events = readEvents(climb.logFile);

    assert.equal(events.filter((e) => e.type === "line.drafted").length, 2);
    assert.ok(frictionKinds(events).includes("line.edited"));
    const signed = events.find((e) => e.type === "line.signed");
    assert.equal(signed?.type === "line.signed" && signed.data.hash, sha256(EDITED));
    assert.equal(view.state, "done");
  });

  it("calls a rescue after N falls, and abandoning stops only that route", async () => {
    const failure = { test: "t", scenario: "export", expected: "a", actual: "b" };
    const alwaysFalls: Scenario = {
      ...shareLink,
      routes: shareLink.routes.map((r) => (r.id === "B" ? { ...r, sendFails: Array(4).fill([failure]), leakyFall: false } : r)),
    };
    const climb = simulatedClimb(alwaysFalls, { desk: new FileDesk({ autoSign: true, autoRescue: "abandon" }) });
    const view = await climb.run();
    const events = readEvents(climb.logFile);

    assert.equal(view.state, "done");
    assert.equal(view.routes.find((r) => r.id === "B")?.state, "abandoned");
    assert.equal(view.routes.find((r) => r.id === "A")?.state, "summited");
    const rescue = events.find((e) => e.type === "rescue.called");
    assert.match(rescue?.type === "rescue.called" ? rescue.data.reason : "", /3 falls seguidas/);
    assert.ok(calls(events).some((c) => c.call === "TAKE"));
  });
});
