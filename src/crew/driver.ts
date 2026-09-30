import type { ResolvedConfig } from "../config/types.ts";
import type { Crew, Runner } from "./types.ts";

export interface CrewSetup {
  crew: Crew;
  runner: Runner;
  request: string;
  scenario?: string;
  /** One line for the terminal: who climbs this time. */
  banner: string;
  /** What the human should know to get the crew going, if anything. */
  hint?: string;
}

export interface DriverContext {
  config: ResolvedConfig;
  climbId: string;
  climbDir: string;
  /** What the human asked; may be empty when the driver brings its own (the simulation). */
  request: string;
  scenario?: string;
  speed: number;
}

/**
 * A way to staff a climb: who does the tasks and who runs the commands. The Basecamp is the same
 * for every driver; a new integration is a new driver, never a change in the core.
 */
export interface CrewDriver {
  name: string;
  summary: string;
  /** Returns the crew and the runner, or a message that says what is missing. */
  setup(context: DriverContext): CrewSetup | string;
}
