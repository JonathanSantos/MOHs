import { randomBytes } from "node:crypto";
import { join } from "node:path";
import type { ResolvedConfig } from "../config/types.ts";
import type { ClimbNotes, Crew, CrewObserver, Runner, SealedTests } from "../crew/types.ts";
import type { PlannedRoute } from "../domain/plan.ts";
import type { ClimbKind, Hardness } from "../domain/types.ts";
import type { CheckDefinition } from "../index.ts";
import type { SurveyResult } from "../survey/survey.ts";
import { readText } from "../util/fs.ts";
import { formatO2 } from "../util/o2.ts";
import { emptyView, project, reduce } from "../view/reducer.ts";
import type { ClimbView } from "../view/types.ts";
import { CLIMB_FILES, type Desk } from "./desk.ts";
import { climbDir, EventLog, readEvents } from "./event-log.ts";
import { HumanGate } from "./human-gate.ts";
import type { Integration } from "./integration.ts";
import { Journal } from "./journal.ts";
import type { ResumePoint } from "./resume.ts";
import { TraceLog } from "./trace.ts";

export interface ClimbPlan {
  kind: ClimbKind;
  hardness: Hardness;
  routes: PlannedRoute[];
  /** The line the scout wrote with the plan. Only kept for a fluorite climb: harder ones need the setter's. */
  line?: string;
}

export interface SessionOptions {
  config: ResolvedConfig;
  crew: Crew;
  runner: Runner;
  desk: Desk;
  request: string;
  climbId?: string;
  scenario?: string;
  /** Forces every route to this hardness (the --hardness flag). */
  hardness?: Hardness;
  /** Picks up a climb whose Basecamp stopped: what its log says is done is not done again. */
  resume?: ResumePoint;
  clock?: () => Date;
}

/** Stops the whole climb on purpose: a human chose to, or the crew cannot take this climb. */
export class ClimbAborted extends Error {
  readonly actor: "human" | "basecamp";

  constructor(message: string, actor: "human" | "basecamp" = "human") {
    super(message);
    this.actor = actor;
  }
}

/**
 * A talc fix that turned out bigger or more delicate: the climb stops on purpose and asks for the full flow.
 * `by` is who saw it: the climber (the escalate answer) or the Basecamp (the fix went past the talc bounds).
 */
export class ClimbEscalated extends Error {
  readonly by: "climber" | "basecamp";

  constructor(reason: string, by: "climber" | "basecamp") {
    super(reason);
    this.by = by;
  }
}

/** Everything the stages of one climb share. */
export class ClimbSession {
  readonly id: string;
  readonly dir: string;
  readonly request: string;
  readonly scenario?: string;
  readonly forcedHardness?: Hardness;
  readonly config: ResolvedConfig;
  readonly crew: Crew;
  readonly runner: Runner;
  readonly log: EventLog;
  readonly journal: Journal;
  readonly view: ClimbView;
  readonly gate: HumanGate;
  /** Sealed tests per route, in memory for the belayer and the leak guard. The files stay with the runner. */
  readonly sealed = new Map<string, SealedTests>();
  /** The same tests as one text per route, for the leak guard. */
  readonly sealedCode = new Map<string, string>();
  readonly trace: TraceLog;
  readonly desk: Desk;
  readonly resume?: ResumePoint;
  /** The project's TypeScript checks, loaded when the climb starts. */
  checks: CheckDefinition[] = [];
  /** The delivery branch that joins the routes, when the climb has more than one. */
  integration?: Integration;
  private scoutedPlan?: ClimbPlan;
  private surveyed?: SurveyResult;
  private o2Exceeded = false;

  constructor(options: SessionOptions) {
    this.id = options.climbId ?? newClimbId(options.clock?.() ?? new Date());
    this.dir = climbDir(options.config.mohsDir, this.id);
    this.request = options.request;
    this.scenario = options.scenario;
    this.forcedHardness = options.hardness;
    this.config = options.config;
    this.crew = options.crew;
    this.runner = options.runner;
    this.log = new EventLog(this.id, this.dir, options.clock);
    this.journal = new Journal(this.log);
    this.trace = new TraceLog(this.dir);
    this.resume = options.resume;
    // Retomado, o climb parte da projeção do log que já existe; dali em diante, projeção estrita como sempre.
    this.view = options.resume ? project(readEvents(this.log.file)) : emptyView(this.id);
    // O Basecamp projeta em modo estrito: uma transição inválida é bug e precisa parar o climb.
    this.log.subscribe((event) => reduce(this.view, event, true));
    this.desk = options.desk;
    this.gate = new HumanGate({ desk: options.desk, dir: this.dir, journal: this.journal, view: this.view });
  }

  get survey(): SurveyResult {
    if (!this.surveyed) throw new Error("Survey requested before the survey stage ran");
    return this.surveyed;
  }

  set survey(result: SurveyResult) {
    this.surveyed = result;
  }

  /**
   * Hooks for one crew task: every tool use goes to the trace; brake denials become friction
   * on the event log, tied to the route and pitch.
   */
  observerFor(where: { route?: string; pitch?: number } = {}): CrewObserver {
    return {
      onToolUse: (record) => this.trace.append({ ...record, ...where }),
      onDenied: (tool, reason) => this.journal.friction("brake.denied", `${tool}: ${reason}`, where),
    };
  }

  get plan(): ClimbPlan {
    if (!this.scoutedPlan) throw new Error("Climb plan requested before the scout stage ran");
    return this.scoutedPlan;
  }

  set plan(plan: ClimbPlan) {
    this.scoutedPlan = plan;
  }

  get paths() {
    return {
      line: join(this.dir, CLIMB_FILES.line),
      bolts: (routeId: string) => join(this.dir, "bolts", `${routeId}.md`),
    };
  }

  /** The survey, the signed line and, for a route, its bolts: what every role after the scout reads. */
  notes(routeId?: string): ClimbNotes {
    return { survey: this.survey.summary, line: this.view.line?.text, bolts: routeId ? this.boltsOf(routeId) : undefined };
  }

  /**
   * A route's bolts, followed by those of the routes it starts from (`after`): code written for it uses their
   * interface, which is not in the project yet when the seal is written.
   */
  private boltsOf(routeId: string): string | undefined {
    const route = this.scoutedPlan?.routes.find((r) => r.id === routeId);
    const own = readText(this.paths.bolts(routeId)) ?? undefined;
    const inherited = (route?.after ?? []).flatMap((id) => {
      const text = readText(this.paths.bolts(id));
      return text ? [`### Da route ${id} (esta route parte do resultado dela)\n\n${text.trim()}`] : [];
    });
    return [own?.trim(), ...inherited].filter(Boolean).join("\n\n") || undefined;
  }

  /** Records `o2.exceeded` once, the first time spending goes past the cylinder. */
  checkO2(): void {
    const { used, budget } = this.view.o2;
    if (this.o2Exceeded || budget === 0 || used <= budget) return;
    this.o2Exceeded = true;
    this.journal.friction("o2.exceeded", `O₂ gasto (${formatO2(used)}) passou do cilindro (${formatO2(budget)})`);
  }
}

/** Sortable, filesystem-safe on every OS (no `:`), e.g. `20260929-1752-c2f3`. */
export function newClimbId(now: Date): string {
  const stamp = now.toISOString().slice(0, 16).replace(/[-:]/g, "").replace("T", "-");
  return `${stamp}-${randomBytes(2).toString("hex")}`;
}
