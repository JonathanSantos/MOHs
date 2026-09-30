import type { RackItem, ResolvedConfig } from "../config/types.ts";
import { MOHS_SCALE, type Hardness, type Role } from "../domain/types.ts";
import { bestMatch } from "../util/glob.ts";
import { estimateTokens } from "../util/o2.ts";
import { evaluateWhen, type MatchTarget } from "./when.ts";

export interface RackQuery extends MatchTarget {
  role: Role;
}

export interface MatchedItem {
  item: RackItem;
  /** full: the body goes into the pack. index: only name and description. */
  mode: "full" | "index";
  reason: string;
  specificity: number;
  tokens: number;
}

export interface RackSelection {
  role: Role;
  budget: number;
  used: number;
  included: MatchedItem[];
  indexed: MatchedItem[];
  overflow: MatchedItem[];
  excluded: { name: string; reason: string }[];
}

/** Why a skill is a candidate. Higher tiers are packed first. */
const TIER = { pinned: 3, alwaysLoaded: 2, matched: 1, indexed: 0 } as const;

interface Candidate extends MatchedItem {
  tier: number;
}

/**
 * Decides by rule which skills enter a role's pack; the model never has to remember to look for them.
 * Candidates are ranked (tier, priority, specificity, name) and packed until the role's O₂ budget runs out.
 */
export function selectSkills(config: ResolvedConfig, query: RackQuery): RackSelection {
  const settings = config.settings.rack.roles[query.role];
  const pinned = new Set(settings.always);
  const excludedNames = new Set(settings.exclude);
  const selection: RackSelection = {
    role: query.role,
    budget: settings.o2,
    used: 0,
    included: [],
    indexed: [],
    overflow: [],
    excluded: [],
  };

  const candidates: Candidate[] = [];
  for (const skill of config.skills.filter((s) => s.roles.includes(query.role))) {
    if (excludedNames.has(skill.name)) {
      selection.excluded.push({ name: skill.name, reason: `rack.${query.role}.exclude` });
      continue;
    }
    const candidate = toCandidate(skill, query, pinned.has(skill.name));
    if (candidate) candidates.push(candidate);
  }

  for (const candidate of candidates.sort(byRank)) {
    const { tier: _tier, ...matched } = candidate;
    if (selection.used + matched.tokens > selection.budget) {
      selection.overflow.push(matched);
      continue;
    }
    selection.used += matched.tokens;
    (matched.mode === "full" ? selection.included : selection.indexed).push(matched);
  }
  return selection;
}

/** Beta has no budget of its own: it is short project knowledge, and `mohs doctor` flags it when it grows. */
export function selectBeta(config: ResolvedConfig, query: RackQuery): MatchedItem[] {
  return config.beta
    .filter((beta) => beta.roles.includes(query.role))
    .map((beta) => ({ beta, when: evaluateWhen(beta.when, query) }))
    .filter(({ when }) => when.matches)
    .map(({ beta, when }) => fullMatch(beta, beta.when ? when.reason : "sempre", when.specificity))
    .sort((a, b) => b.item.priority - a.item.priority || a.item.name.localeCompare(b.item.name));
}

/** None on talc and fluorite, all on diamond, and on quartz only those the diff triggers. */
export function selectInspectors(config: ResolvedConfig, hardness: Hardness, files: readonly string[]): RackItem[] {
  if (MOHS_SCALE[hardness] <= MOHS_SCALE.fluorite) return [];
  return config.inspectors.filter((inspector) => {
    if (!(inspector.hardness ?? []).includes(hardness)) return false;
    if (hardness === "diamond") return true;
    const globs = inspector.when?.files;
    return !globs || bestMatch(files, globs) !== null;
  });
}

export function indexLine(item: RackItem): string {
  return `- ${item.name}: ${item.description}`;
}

function toCandidate(skill: RackItem, query: RackQuery, pinned: boolean): Candidate | null {
  if (pinned) return { ...fullMatch(skill, "sempre (mohs.yaml)", 0), tier: TIER.pinned };
  const when = evaluateWhen(skill.when, query);
  if (!when.matches) return null;
  if (skill.load === "always") return { ...fullMatch(skill, "load: always", when.specificity), tier: TIER.alwaysLoaded };
  if (skill.load === "match" && skill.when) return { ...fullMatch(skill, when.reason, when.specificity), tier: TIER.matched };
  return { ...indexMatch(skill, skill.when ? when.reason : "índice"), tier: TIER.indexed };
}

function fullMatch(item: RackItem, reason: string, specificity: number): MatchedItem {
  return { item, mode: "full", reason, specificity, tokens: estimateTokens(item.body) };
}

function indexMatch(item: RackItem, reason: string): MatchedItem {
  return { item, mode: "index", reason, specificity: 0, tokens: estimateTokens(indexLine(item)) };
}

function byRank(a: Candidate, b: Candidate): number {
  return b.tier - a.tier || b.item.priority - a.item.priority || b.specificity - a.specificity || a.item.name.localeCompare(b.item.name);
}
