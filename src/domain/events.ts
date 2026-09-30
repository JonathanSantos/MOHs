import type { Call } from "./calls.ts";
import type { LineDecision, SettledDecision } from "./decisions.ts";
import type { Evidence } from "./evidence.ts";
import type { PlannedRouteWithBudget } from "./plan.ts";
import type { ClassifiedFinding, ClimbKind, FixReason, FrictionKind, Hardness, Proposal, RescueOption, Intent } from "./types.ts";

export interface PackSummary {
  tokens: number;
  skills: string[];
  beta: string[];
  overflow: string[];
}

type Empty = Record<string, never>;

/**
 * Catálogo de eventos do climb: cada tipo com o formato exato do seu payload.
 * É o contrato entre o Basecamp (que grava), o reducer (que projeta) e quem exibe (CLI e Lookout).
 */
export interface EventPayloads {
  "climb.started": { request: string; project: string; scenario?: string; autoSign?: boolean; solo?: boolean };
  "scout.started": Empty;
  "scout.hardness": {
    kind: ClimbKind;
    hardness: Hardness;
    intent?: Intent;
    reason: string;
    budget: number;
    routes: PlannedRouteWithBudget[];
  };
  "scout.escalated": { from: Hardness; to: Hardness; reason: string };
  "survey.started": Empty;
  "survey.ready": { kind: ClimbKind; files: number; summary: string };
  "repro.started": Empty;
  "repro.written": { files: string[]; shows: string; attempt: number };
  /** Every reproduction file fails on the code as it is: the bug is shown. */
  "repro.red": { files: string[]; shows: string; output: string };
  /** The reproduction joined the route's branch as a regression test. */
  "repro.adopted": { files: string[]; skipped: string[] };
  /** A climber's own reproduction (talc), checked: fails on the base, passes now. */
  "repro.verified": { files: { path: string; failedBefore: boolean; passesNow: boolean }[] };
  "line.started": Empty;
  /** `text` is what the human reviews: the setter's `body` and, when there are any, the `decisions` with their options. */
  "line.drafted": { hash: string; text: string; body?: string; decisions?: LineDecision[] };
  /** The human's answers at the signature; `text` is the line as signed, with only what was decided. */
  "line.decided": { hash: string; text: string; decisions: SettledDecision[] };
  "line.signed": { hash: string; by: string };
  /** Something besides the line waits for a human signature: diamond bolts, a diamond summit. */
  "signature.requested": { target: string; what: string; hash: string; review: string; text?: string };
  "signature.given": { target: string; hash: string; by: string };
  "bolts.started": Empty;
  "bolts.set": { hash: string };
  "seal.started": Empty;
  "seal.written": { unit: number; e2e: number; attempt: number; cases?: number };
  "seal.red": { total: number };
  /** The climber contests a FALL with the line; the belayer upholds the test or corrects it (seal.amended). */
  "seal.disputed": { excerpt: string; argument: string };
  "seal.upheld": { reason: string };
  "seal.amended": { reason: string; unit: number; e2e: number };
  /** The order the routes go up in: routes of the same window share no files. Each route starts as soon as it can. */
  "ascent.planned": { windows: string[][] };
  /** Choices the climber made alone (talc has no line): the human confirms them when signing the summit. */
  "decisions.taken": { decisions: string[] };
  /** A rigged route waits for these routes to join the delivery before it starts. */
  "route.waiting": { for: string[] };
  /** Logs before 5.2: routes went up one window at a time. */
  "window.opened": { n: number; routes: string[] };
  "route.started": { workspace?: string; branch?: string };
  "pitch.started": { title: string; crux: boolean; model: string; pack: PackSummary };
  "pitch.retry": { attempt: number };
  "pitch.anchor": { commit?: string; checks: string[]; fix?: FixReason; files?: string[] };
  "send.started": { attempt: number; fullSuite: boolean };
  "send.clean": { attempt: number; total: number };
  "send.fall": { attempt: number; failed: number; total: number };
  "fix.started": { reason: FixReason; details: string[] };
  "inspection.started": { inspectors: string[]; round: number };
  "inspection.report": { inspector: string; round: number; findings: ClassifiedFinding[] };
  "inspection.blocked": { count: number; round: number };
  "findings.resolved": { round: number };
  /** `evidence` says what proved the route (absent in logs before 5.3). */
  "route.summit": { ms: number; branch?: string; commits?: number; evidence?: Evidence };
  /** A summited route went into the climb's delivery branch. */
  "integration.merged": { commit?: string };
  "integration.conflict": { files: string[] };
  "integration.started": { attempt: number };
  "integration.clean": { attempt: number; total: number };
  "integration.fall": { attempt: number; failed: number; total: number };
  "integration.fixed": { commit?: string; checks: string[] };
  "integration.done": { branch?: string; commits?: number; routes: string[] };
  "route.abandoned": { reason: string };
  call: Call;
  friction: { kind: FrictionKind; detail: string };
  "rescue.called": { reason: string; options: RescueOption[] };
  "rescue.resolved": { option: RescueOption };
  "descent.started": Empty;
  "descent.beta": { proposals: Proposal[] };
  /** A human chose a proposal; `file` is where it went, or nothing when it has to be applied by hand. */
  "beta.accepted": { id: string; file?: string };
  "beta.rejected": { id: string };
  "climb.done": { o2: number };
  "climb.aborted": { reason: string };
  /** `mohs croqui`: the scout sketches the project, a human signs, and it is saved for every later climb. */
  "croqui.started": Empty;
  "croqui.drafted": { hash: string; entities: number; sections: number };
  "croqui.saved": { file: string };
  /** A new Basecamp picked the climb up after the previous one stopped; `after` is the last event it had written. */
  "climb.resumed": { after: number };
  /** A talc fix asked for the full flow; `mohs climb --from <id>` starts it with the same request. */
  "climb.escalated": { reason: string };
}

export type EventType = keyof EventPayloads;

export interface EventMeta {
  actor: string;
  route?: string;
  pitch?: number;
  /** Tokens gastos pela ação que gerou o evento. */
  o2?: number;
}

interface EventEnvelope extends EventMeta {
  seq: number;
  ts: string;
  climb: string;
}

/** União discriminada por `type`: um `switch` ou um registry por tipo já recebe o `data` certo. */
export type MohsEvent<K extends EventType = EventType> = {
  [T in K]: EventEnvelope & { type: T; data: EventPayloads[T] };
}[K];

export type EventInput<K extends EventType = EventType> = {
  [T in K]: EventMeta & { type: T; data: EventPayloads[T] };
}[K];
