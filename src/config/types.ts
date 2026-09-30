import type { LoadedCroqui } from "../domain/croqui.ts";
import type { Hardness, Role, Severity } from "../domain/types.ts";

export type LayerKind = "core" | "guidebook" | "user" | "source" | "project" | "override";

export interface LayerInfo {
  kind: LayerKind;
  label: string;
  dir: string;
}

export interface Diagnostic {
  level: "error" | "warn" | "info";
  message: string;
  file?: string;
  line?: number;
}

export type ItemKind = "skill" | "beta" | "inspector";
export type LoadMode = "always" | "match" | "index";

export interface WhenClause {
  files?: string[];
  hardness?: Hardness[];
  tags?: string[];
}

/** Anything a layer contributes as a Markdown file: skills, beta and inspectors. */
export interface RackItem {
  kind: ItemKind;
  name: string;
  description: string;
  roles: Role[];
  when?: WhenClause;
  load: LoadMode;
  priority: number;
  /** Inspectors only: hardness levels the inspector may run on. */
  hardness?: Hardness[];
  model?: string;
  /** Inspectors only: also read the tests in the diff (by default they are only listed). */
  tests?: boolean;
  body: string;
  file: string;
  layer: string;
  /** Earlier layers that defined an item with the same name and were overridden. */
  replaced: string[];
}

export interface CheckRef {
  name: string;
  file: string;
  layer: string;
}

export interface RackRoleSettings {
  always: string[];
  exclude: string[];
  o2: number;
}

export type Effort = "low" | "medium" | "high" | "xhigh" | "max";

export interface ProviderSettings {
  type: "anthropic" | "openai-compatible";
  baseUrl?: string;
  apiKeyEnv?: string;
}

export interface Settings {
  /** `seal` and `sealE2e` run one sealed test file each, with `{file}` in place of its path. */
  commands: { anchor: string[]; send: string[]; e2e: string[]; seal?: string; sealE2e?: string; dev?: string; timeoutMs: number };
  providers: Record<string, ProviderSettings>;
  /** maxO2PerTask is a hard stop for a single agent run; the hardness cylinder is the climb-wide budget. */
  agents: { maxTurns: number; effort: Effort; fallbacks: boolean; maxO2PerTask: number };
  /** Extra commands the climber may run besides the anchor commands. */
  tools: { commands: string[] };
  models: Record<Role | "crux", string>;
  rack: { sources: string[]; roles: Record<Role, RackRoleSettings> };
  /** O₂ cylinder per route, and how many sealed test cases each scenario of the line may get. */
  hardness: Record<Hardness, { o2: number; testsPerScenario: number }>;
  /** Bounds of a talc fix (`mohs fix`): past them, or on a sensitive file, the climb asks for the full flow. */
  talc: { maxFiles: number; maxLines: number; sensitive: string[] };
  lookout: { port: number };
}

export interface BrakePolicy {
  block: Severity[];
  warn: Severity[];
  ignore: Severity[];
  minConfidence: number;
  fallsBeforeRescue: number;
  inspectionRounds: number;
}

export interface ResolvedConfig {
  projectRoot: string;
  mohsDir: string;
  layers: LayerInfo[];
  settings: Settings;
  brake: BrakePolicy;
  skills: RackItem[];
  beta: RackItem[];
  inspectors: RackItem[];
  checks: CheckRef[];
  /** The project's signed croqui, when there is one. */
  croqui?: LoadedCroqui;
  diagnostics: Diagnostic[];
}
