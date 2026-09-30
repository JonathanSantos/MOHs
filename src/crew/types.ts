import type { RackItem } from "../config/types.ts";
import type { Croqui } from "../domain/croqui.ts";
import type { PlannedRoute } from "../domain/plan.ts";
import type { Finding, FixReason, FrictionKind, Hardness, Proposal, Role } from "../domain/types.ts";
import type { Pack } from "../pack/build.ts";
import type { SurveyResult } from "../survey/survey.ts";
import type { ClimbView } from "../view/types.ts";

/** Tokens spent by the work. */
export interface Work {
  o2: number;
}

/** One sealed test file that failed in the send, with the tail of its output. Only the belayer reads it. */
export interface SendFailure {
  test: string;
  output: string;
  /** The route whose sealed test failed; absent for a suite command. */
  route?: string;
}

export interface SealedFile {
  /** Where the file goes, relative to the project root. */
  path: string;
  content: string;
  /** `support` files are helpers the tests import: kept sealed, written with them, never run on their own. */
  kind: "unit" | "e2e" | "support";
}

/** The belayer's tests. They live outside every place the climber can reach and meet its code only in the send. */
export interface SealedTests {
  files: SealedFile[];
  unit: number;
  e2e: number;
  /** Test cases declared in the files, when the crew counted them. */
  cases?: number;
  /** The belayer went past the route's test budget twice; the seal was kept anyway. */
  oversized?: { cases: number; budget: number };
}

/** All sealed code as one text, for the leak guard. */
export function sealedCode(sealed: SealedTests | undefined): string {
  return sealed?.files.map((file) => file.content).join("\n") ?? "";
}

/** Where a route's work happens: a git worktree for real climbs, nothing for simulated ones. */
export interface RouteWorkspace {
  path: string;
  branch?: string;
}

export interface ToolUseRecord {
  role: Role;
  turn: number;
  tool: string;
  outcome: "ok" | "error" | "denied";
  detail?: string;
  ms: number;
}

/** What a crew reports while it works: every tool use goes to the trace, brake denials to friction. */
export interface CrewObserver {
  onToolUse?(record: ToolUseRecord): void;
  onDenied?(tool: string, reason: string): void;
}

/** Passed to every model-backed task, so whatever the crew reports lands on the climb. */
export interface TaskContext {
  observer: CrewObserver;
}

export type CrewErrorKind = Extract<FrictionKind, "agent.limit" | "agent.refusal" | "provider.error">;

/**
 * The crew could not finish a task: the agent hit a limit, refused or its provider failed.
 * The Basecamp turns it into friction and a rescue; every driver maps its own errors to this one.
 */
export class CrewError extends Error {
  readonly kind: CrewErrorKind;
  /** Tokens spent before the failure. */
  readonly o2: number;

  constructor(kind: CrewErrorKind, message: string, o2 = 0) {
    super(message);
    this.kind = kind;
    this.o2 = o2;
  }
}

/** What every role after the scout reads about the climb, besides its own task. */
export interface ClimbNotes {
  survey: string;
  line?: string;
  bolts?: string;
}

export interface NotesContext extends TaskContext {
  notes: ClimbNotes;
}

export interface SealContext extends NotesContext {
  /** A throwaway checkout of the current code, where the belayer writes and runs the sealed tests. */
  workspace: RouteWorkspace;
  attempt: number;
  feedback?: string;
}

export interface FallContext extends NotesContext {
  sealed: SealedTests;
  /** Excerpts of the sealed code that the last FALL copied; the belayer must rewrite without them. */
  leaked?: string[];
}

export interface InspectContext extends NotesContext {
  /** The route's worktree, for reading around the diff. */
  workspace: RouteWorkspace;
  diff: string;
}

export interface PitchContext extends TaskContext {
  /** Everything the climber needs, assembled by the Basecamp by rule. */
  pack: Pack;
  attempt: number;
  workspace: RouteWorkspace;
  /** What went wrong last time (anchor output, a human answer), so the climber does not repeat it. */
  feedback?: string;
}

/**
 * How a pitch ended, mirroring the calls: SAFE (done), WATCH (the line does not hold together), ROCK (the environment
 * is broken) or, in a talc fix, ESCALATE (it is not a small fix). A SAFE may still report a rock the climber worked
 * around, a note about something it saw outside the pitch, and the decisions it took alone.
 */
export type PitchOutcome =
  | { outcome: "safe"; summary: string; rock?: { command: string; error: string }; note?: string; decisions?: string[] }
  | { outcome: "watch"; excerpt: string; question: string }
  | { outcome: "rock"; command: string; error: string }
  | { outcome: "escalate"; reason: string };

export type PitchResult = PitchOutcome & Work & { friction?: { kind: FrictionKind; detail: string }[] };

/** How a fix ended: done, or the climber contests the sealed test with the line (only after a FALL). */
export type FixResult = Work & ({ outcome: "safe"; summary: string } | { outcome: "dispute"; excerpt: string; argument: string });

export interface Dispute {
  excerpt: string;
  argument: string;
}

export interface DisputeContext extends NotesContext {
  sealed: SealedTests;
  failures: readonly SendFailure[];
  /** What the climber was told. */
  fall: { scenario: string; expected: string; actual: string };
  dispute: Dispute;
  /** A throwaway checkout with the sealed files, where the belayer may correct them. */
  workspace: RouteWorkspace;
  /** A human sided with the climber: the belayer corrects the test, no upholding. */
  mustAmend?: boolean;
}

/** The belayer's answer to a dispute: the test stands (with why), or it is corrected. */
export type DisputeVerdict = Work & ({ verdict: "uphold"; reason: string } | { verdict: "amend"; reason: string; sealed: SealedTests });

export interface FallReport extends Work {
  scenario: string;
  expected: string;
  actual: string;
}

/**
 * The roles backed by a model. The simulated crew plays every role; the task crew grows phase by
 * phase and declares which hardness levels it can take to the summit.
 */
export interface Crew {
  readonly supportedHardness?: readonly Hardness[];
  /** The plan; for a climb of fluorite routes only, the scout may write the line with it and spare the setter. */
  scout(
    request: string,
    survey: SurveyResult,
    context: TaskContext,
  ): Promise<Work & { reason: string; routes: PlannedRoute[]; line?: string }>;
  writeLine(request: string, routes: readonly PlannedRoute[], survey: SurveyResult, context: TaskContext): Promise<Work & { text: string }>;
  setBolts(route: PlannedRoute, context: NotesContext): Promise<Work & { text: string }>;
  seal(route: PlannedRoute, context: SealContext): Promise<Work & SealedTests>;
  climbPitch(route: PlannedRoute, pitch: number, context: PitchContext): Promise<PitchResult>;
  fix(route: PlannedRoute, reason: FixReason, details: readonly string[], context: PitchContext): Promise<FixResult>;
  explainFall(route: PlannedRoute, failures: readonly SendFailure[], context: FallContext): Promise<FallReport>;
  judgeDispute(route: PlannedRoute, context: DisputeContext): Promise<DisputeVerdict>;
  inspect(
    route: PlannedRoute,
    inspector: RackItem,
    round: number,
    context: InspectContext,
  ): Promise<Work & { findings: Omit<Finding, "inspector">[] }>;
  descent(view: ClimbView, context: NotesContext): Promise<Work & { proposals: Proposal[] }>;
  /** The project's croqui, drawn once and signed by a human. */
  drawCroqui(survey: SurveyResult, context: TaskContext): Promise<Work & { croqui: Croqui }>;
}

export interface ExecResult {
  code: number;
  output: string;
}

export type AnchorVerify = (exec: (command: string) => Promise<ExecResult>) => Promise<string | null>;

export interface AnchorResult {
  ok: boolean;
  checks: string[];
  output?: string;
  commit?: string;
  /** Files the commit changed, relative to the project root. The Basecamp compares them with the pitch. */
  files?: string[];
}

export interface Delivery {
  branch?: string;
  commits?: number;
}

export type IntegrationMerge = { ok: true; commit: string } | { ok: false; conflicts: string[] };

export interface SendResult {
  ok: boolean;
  total: number;
  failures: SendFailure[];
}

/** What the harness runs by itself. It is never the agent who says the checks passed. */
export interface Runner {
  survey(): Promise<SurveyResult>;
  /** Why this runner cannot rig routes (seal and send) in this project with the current config, or null when it can. */
  riggingProblem?(survey: SurveyResult): string | null;
  prepare(route: PlannedRoute): Promise<RouteWorkspace>;
  /**
   * Runs the anchor commands and, when they pass, `verify` (the project's TypeScript checks) before committing.
   * `verify` returns what failed, or null.
   */
  anchor(route: PlannedRoute, pitch: number, attempt: number, commands: readonly string[], verify?: AnchorVerify): Promise<AnchorResult>;
  /** Runs a command in the route's worktree, for checks. */
  exec(route: PlannedRoute, command: string): Promise<ExecResult>;
  /** A throwaway checkout of the current code for the belayer. */
  prepareSeal(route: PlannedRoute): Promise<RouteWorkspace>;
  /** Keeps the sealed tests out of reach and runs them on the current code: each one must fail. */
  sealRed(route: PlannedRoute, sealed: SealedTests): Promise<{ allRed: boolean; passing: string[] }>;
  /** Runs the sealed tests on the route's latest commit, in a checkout the climber never sees. */
  send(route: PlannedRoute, attempt: number, commands: readonly string[]): Promise<SendResult>;
  /** What the route changed so far, for the inspectors. */
  diff(route: PlannedRoute): Promise<string>;
  /** The route's last commit, which a diamond summit signature is bound to. */
  head(route: PlannedRoute): Promise<string>;
  /**
   * Brings a route that reached the summit into the climb's delivery branch; routes of later windows start from
   * there. On a conflict the merge waits, in the delivery worktree, for someone to resolve it.
   */
  integrate(route: PlannedRoute): Promise<IntegrationMerge>;
  /** The delivery branch's worktree, where integration fixes happen. */
  deliveryWorkspace(): Promise<RouteWorkspace>;
  /** Anchor commands in the delivery worktree, then a commit (which also concludes a resolved merge). */
  anchorDelivery(attempt: number, commands: readonly string[], message: string): Promise<AnchorResult>;
  /** Every route's sealed tests plus `commands` on the delivery branch, in a throwaway checkout. */
  sendDelivery(attempt: number, commands: readonly string[]): Promise<SendResult>;
  finishDelivery(): Promise<Delivery>;
  /** A resumed climb: the delivery branch an earlier run created, adopted before any route starts. */
  resumeDelivery?(): Promise<void>;
  /** A resumed climb: the sealed tests an earlier run kept for the route, or null (then the route is sealed again). */
  restoreSeal?(route: PlannedRoute): Promise<SealedTests | null>;
  finish(route: PlannedRoute, outcome: "summit" | "abandoned"): Promise<Delivery>;
}

/** A capability that arrives in a later phase. */
export class NotYetSupported extends Error {}
