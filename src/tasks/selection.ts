import type { Role } from "../domain/types.ts";
import type { TaskRecord } from "./file-board.ts";
import type { Situation, TaskBrief } from "./situation.ts";

/** Who is asking for work: a role, a route and a name, all optional (an agent alone asks for anything). */
export interface Seeker {
  role?: Role;
  route?: string;
  as?: string;
  /** Roles this agent (`as`) already took in this climb. */
  took?: readonly Role[];
  /** A solo climb: one agent plays every role, so nothing is sealed from it and no role keeps it away from another. */
  solo?: boolean;
}

/** Tasks of these roles show only to whoever asks for the role by name: the belayer's tests must stay sealed. */
const SEALED_ROLES: ReadonlySet<Role> = new Set(["belayer"]);

/** Roles one agent never takes in the same climb: whoever wrote the sealed tests does not implement. */
const APART: readonly (readonly [Role, Role])[] = [["belayer", "climber"]];

/**
 * Narrows an open situation to what this agent should do. Tasks outside its role or route are only named (handoff);
 * tasks another agent holds are reported as held, so two agents never work on the same one. A single free task shows
 * in full. Several free tasks become a board, even for one role (two inspectors pick theirs by `--task`, instead of
 * whichever comes first); so do, without a role, a task another agent holds or a sealed one.
 */
export function forAgent(situation: Situation, seeker: Seeker): Situation {
  if (situation.kind !== "task") return situation;
  const open = [situation.task, ...situation.others];
  const took = seeker.solo ? [] : (seeker.took ?? []);
  const wanted = open.filter((task) => (!seeker.role || task.role === seeker.role) && (!seeker.route || task.route === seeker.route));
  const matching = wanted.filter((task) => !apartFrom(task.role, took));
  if (!matching.length) {
    if (wanted.length) return { kind: "apart", tasks: wanted.map(brief), took: apartFrom(wanted[0].role, took)! };
    return { kind: "handoff", tasks: open.map(brief) };
  }
  const free = seeker.as ? matching.filter((task) => !task.claimedBy || task.claimedBy === seeker.as) : matching;
  if (!free.length) return { kind: "held", tasks: matching.map(brief) };
  const mineFirst = [...free].sort((a, b) => Number(b.claimedBy === seeker.as) - Number(a.claimedBy === seeker.as));
  const [first] = mineFirst;
  const own = seeker.as !== undefined && first.claimedBy === seeker.as;
  const heldElsewhere = first.claimedBy !== undefined && !own;
  const sealed = !seeker.solo && SEALED_ROLES.has(first.role);
  if (!own && (free.length > 1 || (!seeker.role && (heldElsewhere || sealed)))) return { kind: "board", tasks: matching.map(brief) };
  return { kind: "task", task: first, others: mineFirst.slice(1) };
}

/** The role this agent took that keeps it away from `role`, if any. */
export function apartFrom(role: Role, took: readonly Role[]): Role | undefined {
  return took.find((taken) => APART.some(([a, b]) => (a === role && b === taken) || (b === role && a === taken)));
}

export function isSealedRole(role: Role): boolean {
  return SEALED_ROLES.has(role);
}

function brief({ id, role, title, route, claimedBy, claimedAt }: TaskRecord): TaskBrief {
  return { id, role, title, route, claimedBy, claimedAt };
}
