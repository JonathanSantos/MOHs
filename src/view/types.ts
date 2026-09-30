import type { ClimbState, RouteState } from "../domain/states.ts";
import type { LineDecision, SettledDecision } from "../domain/decisions.ts";
import type { Evidence } from "../domain/evidence.ts";
import type { ClassifiedFinding, ClimbKind, FrictionKind, Hardness, Proposal, RescueOption, Intent } from "../domain/types.ts";

export interface PitchView {
  n: number;
  title: string;
  crux: boolean;
  files: string[];
  state: "ready" | "climbing" | "anchored";
}

export interface FindingView extends ClassifiedFinding {
  route: string;
  fixed: boolean;
}

export interface FrictionView {
  seq: number;
  ts: string;
  kind: FrictionKind;
  route?: string;
  pitch?: number;
  detail: string;
}

export interface CallView {
  seq: number;
  ts: string;
  call: string;
  from: string;
  to: string;
  route?: string;
  text: string;
}

export type Tone = "ok" | "crit" | "warn" | "plain" | "muted";

export interface TimelineEntry {
  seq: number;
  ts: string;
  tag: string;
  tone: Tone;
  route?: string;
  who?: string;
  text: string;
}

export interface RouteView {
  id: string;
  name: string;
  hardness: Hardness;
  mohs: number;
  files: string[];
  tags: string[];
  state: RouteState;
  /** Short label for what the route is doing now: "pitch 2", "anchor 2", "send", "fall"... */
  label: string;
  /** Climber position on the wall, in pitches (0 = base, N = top). */
  pos: number;
  pitches: PitchView[];
  falls: number;
  o2: number;
  budget: number;
  bolts: boolean;
  seal?: { unit: number; e2e: number; red: boolean };
  /** What the route waits for before it goes on: routes it starts from, or its own seal before the send. */
  waitingFor?: string[];
  inspectors: string[];
  findings: FindingView[];
  friction: FrictionView[];
  window?: number;
  /** Real climbs only: the branch holding the route's commits. */
  branch?: string;
  commits?: number;
  /** What proved the route at the summit. */
  evidence?: Evidence;
  /** Choices the climber made alone, in a talc fix. */
  decisions?: string[];
  startedAt?: string;
  summitAt?: string;
}

export interface ProposalView extends Proposal {
  status: "pending" | "accepted" | "rejected";
  /** Where an accepted proposal went. */
  file?: string;
}

export interface DeliveryView {
  merged: string[];
  conflicts: number;
  falls: number;
  clean: boolean;
  branch?: string;
  commits?: number;
}

export interface SignatureView {
  target: string;
  what: string;
  review: string;
  text?: string;
  hash: string;
  route?: string;
  signed: boolean;
  by?: string;
}

export interface ClimbView {
  id: string;
  request: string;
  project: string;
  scenario?: string;
  /** Line signatures are automatic in this climb (--auto-sign). */
  autoSign?: boolean;
  /** One agent plays every role: the tests come first, visible and locked, instead of sealed. */
  solo?: boolean;
  state: ClimbState;
  resumeTo?: ClimbState;
  kind?: ClimbKind;
  hardness?: Hardness;
  intent?: Intent;
  reason?: string;
  startedAt: string;
  updatedAt: string;
  endedAt?: string;
  o2: { used: number; budget: number };
  routes: RouteView[];
  windows: string[][];
  survey?: { files: number; summary: string };
  line?: {
    hash: string;
    text: string;
    signed: boolean;
    signedBy?: string;
    drafts: number;
    /** The setter's text without the decisions, and the decisions with their options, while the line waits. */
    body?: string;
    decisions?: LineDecision[];
    /** What the human settled at the signature. */
    settled?: SettledDecision[];
  };
  /** The delivery branch that joins every route, when the climb has more than one. */
  delivery?: DeliveryView;
  /** Signatures besides the line's: diamond bolts and summits. */
  signatures: SignatureView[];
  rescue?: { seq: number; reason: string; options: RescueOption[]; route?: string };
  /** Why a talc fix asked for the full flow. */
  escalation?: string;
  /** Where a croqui climb saved the signed croqui. */
  croqui?: string;
  calls: CallView[];
  /** Events worth showing to whoever is watching, in order. */
  timeline: TimelineEntry[];
  friction: FrictionView[];
  proposals: ProposalView[];
  falls: number;
  lastSeq: number;
  /** Invalid transitions seen while projecting in non-strict mode. */
  errors: string[];
}
