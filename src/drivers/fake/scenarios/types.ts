import type { ClimbKind, Finding, FrictionKind, Hardness, Proposal } from "../../../domain/types.ts";

export type ScenarioFinding = Omit<Finding, "inspector">;

/** A sealed test that fails in the send: the runner reports its output, the belayer explains it. */
export interface ScenarioFailure {
  test: string;
  scenario: string;
  expected: string;
  actual: string;
}

export interface ScenarioPitch {
  title: string;
  files: string[];
  crux?: boolean;
  ms: number;
  o2: number;
  summary: string;
  friction?: { kind: FrictionKind; detail: string }[];
  rock?: { command: string; error: string };
  watch?: { excerpt: string; question: string };
  /** How many anchor attempts fail before one passes. */
  anchorFails?: number;
}

export interface ScenarioRoute {
  id: string;
  name: string;
  hardness: Hardness;
  files: string[];
  tags: string[];
  pitches: ScenarioPitch[];
  seal?: { unit: number; e2e: number; code: string };
  /** Send failures per attempt. Attempts past the end of the list pass. */
  sendFails?: ScenarioFailure[][];
  /** Findings per inspection round, keyed by inspector name. */
  inspections?: Record<string, ScenarioFinding[]>[];
  /** The first FALL quotes the sealed code, to exercise the leak guard. */
  leakyFall?: boolean;
}

/** A scripted climb: what each role "does" in the simulation. */
export interface Scenario {
  name: string;
  description: string;
  request: string;
  kind: ClimbKind;
  reason: string;
  survey: { files: number; summary: string; languages?: string[]; tests?: number };
  line: string;
  routes: ScenarioRoute[];
  proposals: Proposal[];
}
