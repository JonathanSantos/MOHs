import { basename } from "node:path";
import { loadChecks } from "../checks/run.ts";
import type { ClimbView } from "../view/types.ts";
import type { EventListener } from "./event-log.ts";
import { announceBasecamp } from "./presence.ts";
import { ClimbAborted, ClimbEscalated, ClimbSession, type SessionOptions } from "./session.ts";
import { DEFAULT_STAGES, type Stage } from "./stages/index.ts";

export interface BasecampOptions extends SessionOptions {
  stages?: readonly Stage[];
}

/**
 * Drives a climb from scout to descent. Deterministic code: the crew does the work,
 * but deciding the next step, running the checks and applying the brake is always the Basecamp.
 */
export class Basecamp {
  readonly session: ClimbSession;
  private readonly stages: readonly Stage[];

  constructor(options: BasecampOptions) {
    this.session = new ClimbSession(options);
    this.stages = options.stages ?? DEFAULT_STAGES;
  }

  get id(): string {
    return this.session.id;
  }

  get view(): ClimbView {
    return this.session.view;
  }

  get logFile(): string {
    return this.session.log.file;
  }

  subscribe(listener: EventListener): () => void {
    return this.session.log.subscribe(listener);
  }

  async run(): Promise<ClimbView> {
    const { journal, config, request, scenario, desk } = this.session;
    announceBasecamp(this.session.dir);
    const autoSign = desk.autoSigns || undefined;
    if (this.session.resume) journal.record("climb.resumed", { after: this.session.resume.lastSeq }, { actor: "human" });
    else {
      const solo = this.session.solo || undefined;
      journal.record("climb.started", { request, project: basename(config.projectRoot), scenario, autoSign, solo }, { actor: "human" });
    }
    try {
      const { checks, problems } = await loadChecks(config.checks);
      if (problems.length) throw new ClimbAborted(`corrija os checks do projeto antes do climb: ${problems.join("; ")}`, "basecamp");
      this.session.checks = checks;
      for (const stage of this.stages) {
        if (stage.appliesTo(this.session)) await stage.run(this.session);
      }
      journal.record("climb.done", { o2: this.session.view.o2.used }, { actor: "basecamp" });
    } catch (error) {
      if (error instanceof ClimbEscalated) {
        journal.record("climb.escalated", { reason: error.message }, { actor: error.by });
        return this.session.view;
      }
      if (!(error instanceof ClimbAborted)) {
        journal.record("climb.aborted", { reason: `erro interno: ${(error as Error).message}` }, { actor: "basecamp" });
        throw error;
      }
      journal.record("climb.aborted", { reason: error.message }, { actor: error.actor });
    }
    return this.session.view;
  }
}
