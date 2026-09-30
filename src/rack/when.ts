import type { WhenClause } from "../config/types.ts";
import type { Hardness } from "../domain/types.ts";
import { bestMatch } from "../util/glob.ts";

export interface MatchTarget {
  hardness: Hardness;
  /** Files the pitch touches, relative to the project root. */
  files: readonly string[];
  /** Tags from the line (e.g. ui, api, auth). */
  tags: readonly string[];
}

export interface WhenResult {
  matches: boolean;
  reason: string;
  /** Literal prefix length of the glob that matched: more specific skills win ties. */
  specificity: number;
}

const NO_MATCH: WhenResult = { matches: false, reason: "", specificity: 0 };

/** Every condition present in the clause must hold. An absent clause always matches. */
export function evaluateWhen(when: WhenClause | undefined, target: MatchTarget): WhenResult {
  if (!when) return { matches: true, reason: "", specificity: 0 };
  const reasons: string[] = [];
  let specificity = 0;

  if (when.hardness) {
    if (!when.hardness.includes(target.hardness)) return NO_MATCH;
    reasons.push(`hardness ${target.hardness}`);
  }
  if (when.files) {
    const match = bestMatch(target.files, when.files);
    if (!match) return NO_MATCH;
    specificity = match.specificity;
    reasons.push(`${match.file} casa com ${match.glob}`);
  }
  if (when.tags) {
    const tag = when.tags.find((t) => target.tags.includes(t));
    if (!tag) return NO_MATCH;
    reasons.push(`tag ${tag}`);
  }
  return { matches: true, reason: reasons.join(" · "), specificity };
}
