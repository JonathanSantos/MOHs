import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Role } from "../src/domain/types.ts";
import type { TaskRecord } from "../src/tasks/file-board.ts";
import { forAgent } from "../src/tasks/selection.ts";
import type { Situation } from "../src/tasks/situation.ts";

function task(id: string, role: Role, route?: string, claimedBy?: string): TaskRecord {
  return {
    id,
    role,
    route,
    claimedBy,
    title: `${role} ${route ?? ""}`.trim(),
    openedAt: "2026-09-29T20:00:00.000Z",
    cwd: "/projeto",
    access: role === "climber" ? "write" : "read",
    brief: "",
    assignment: "",
    answers: [],
    commands: [],
    checks: [],
    files: [],
    status: "open",
  };
}

function open(...tasks: TaskRecord[]): Situation {
  const [first, ...others] = tasks;
  return { kind: "task", task: first, others };
}

describe("choosing a task for an agent", () => {
  it("shows a single open task in full to whoever asks without a role", () => {
    const situation = forAgent(open(task("T1", "scout")), {});
    assert.equal(situation.kind, "task");
  });

  it("never shows a belayer task to whoever asks without the role", () => {
    const situation = forAgent(open(task("T5", "belayer", "B")), {});
    assert.equal(situation.kind, "board");
    assert.equal(forAgent(open(task("T5", "belayer", "B")), { role: "belayer" }).kind, "task");
  });

  it("turns several open tasks into a board, so each goes to its own agent", () => {
    const situation = forAgent(open(task("T5", "belayer", "B"), task("T7", "climber", "A")), {});
    assert.equal(situation.kind, "board");
    if (situation.kind === "board")
      assert.deepEqual(
        situation.tasks.map((t) => t.id),
        ["T5", "T7"],
      );
  });

  it("lists a task another agent holds instead of showing it to whoever asks without a name", () => {
    assert.equal(forAgent(open(task("T7", "climber", "A", "climber-A")), {}).kind, "board");
  });

  it("still hands an agent the task it already holds", () => {
    const situation = forAgent(open(task("T5", "belayer", "B"), task("T7", "climber", "A", "solo")), { as: "solo" });
    assert.equal(situation.kind, "task");
    if (situation.kind === "task") assert.equal(situation.task.id, "T7");
  });

  it("keeps whoever wrote sealed tests away from implementing, and the other way round", () => {
    const climb = open(task("T7", "climber", "B"));
    const situation = forAgent(climb, { role: "climber", as: "belayer-B", took: ["belayer"] });
    assert.equal(situation.kind, "apart");
    if (situation.kind === "apart") assert.equal(situation.took, "belayer");
    assert.equal(forAgent(open(task("T5", "belayer", "C")), { role: "belayer", as: "climber-A", took: ["climber"] }).kind, "apart");
    assert.equal(forAgent(climb, { role: "climber", as: "climber-B", took: ["climber"] }).kind, "task");
  });
});
