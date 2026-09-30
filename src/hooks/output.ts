import type { StopVerdict, Verdict } from "./policy.ts";

export const PLATFORMS = ["claude", "copilot"] as const;
export type Platform = (typeof PLATFORMS)[number];

interface Dialect {
  deny(reason: string): object;
  block(reason: string): object;
  context(text: string): object;
}

/**
 * How each platform reads a hook's answer. Claude Code nests decisions in `hookSpecificOutput`; Copilot reads them
 * at the top level. Stop blocks look the same on both. Allowing is printing nothing.
 */
const DIALECTS: Record<Platform, Dialect> = {
  claude: {
    deny: (reason) => ({
      hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: reason },
    }),
    block: (reason) => ({ decision: "block", reason }),
    context: (text) => ({ hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: text } }),
  },
  copilot: {
    deny: (reason) => ({ permissionDecision: "deny", permissionDecisionReason: reason }),
    block: (reason) => ({ decision: "block", reason }),
    context: (text) => ({ additionalContext: text }),
  },
};

export function isPlatform(value: unknown): value is Platform {
  return PLATFORMS.includes(value as Platform);
}

export function toolOutput(verdict: Verdict, platform: Platform): object | null {
  return verdict.allow ? null : DIALECTS[platform].deny(`MOHs: ${verdict.reason}`);
}

export function stopOutput(verdict: StopVerdict, platform: Platform): object | null {
  return verdict.allow ? null : DIALECTS[platform].block(verdict.reason);
}

export function contextOutput(text: string | null, platform: Platform): object | null {
  return text ? DIALECTS[platform].context(text) : null;
}
