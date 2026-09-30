import { relative } from "node:path";
import { isInside } from "../util/paths.ts";
import { matchGlob, normalizePath } from "../util/glob.ts";

/** What a tool call touches, so the brake can judge it before it runs. */
export type Access =
  { kind: "read"; paths: string[] } | { kind: "write"; paths: string[] } | { kind: "exec"; command: string } | { kind: "none" };

export interface ToolRules {
  root: string;
  /** Absolute paths no tool may touch: sealed tests, climb logs, other worktrees. */
  denied: readonly string[];
  /** Workspace globs that may be read but never written. */
  readOnly: readonly string[];
  /** Workspace globs no tool may read or write. */
  hidden: readonly string[];
  /** Only these exact commands may run. */
  allowedCommands: readonly string[];
}

export type Verdict = { allowed: true } | { allowed: false; reason: string };

export const DEFAULT_READ_ONLY = ["node_modules/**", "**/node_modules/**", "package-lock.json", "**/package-lock.json"];
export const DEFAULT_HIDDEN = [".git/**", "**/.git/**", ".mohs/**", "**/.env", "**/.env.*"];

/**
 * The brake for tool calls: a pure decision from what the call touches and the rules of the moment.
 * Our own loop asks before every call and agent hooks ask the same question; a denial becomes an
 * error the agent reads and a friction record.
 */
export function judgeToolUse(access: Access, rules: ToolRules): Verdict {
  if (access.kind === "none") return { allowed: true };
  if (access.kind === "exec") return judgeCommand(access.command, rules);

  for (const path of access.paths) {
    if (!isInside(rules.root, path)) return { allowed: false, reason: "o caminho sai do workspace" };
    if (rules.denied.some((denied) => isInside(denied, path))) return { allowed: false, reason: "área protegida do MOHs" };
    const rel = normalizePath(relative(rules.root, path)) || ".";
    if (rules.hidden.some((glob) => matchGlob(rel, glob))) return { allowed: false, reason: `${rel} não é acessível para agentes` };
    if (access.kind === "write" && rules.readOnly.some((glob) => matchGlob(rel, glob)))
      return { allowed: false, reason: `${rel} é somente leitura` };
  }
  return { allowed: true };
}

function judgeCommand(command: string, rules: ToolRules): Verdict {
  const normalized = collapse(command);
  if (rules.allowedCommands.some((allowed) => matchesCommand(collapse(allowed), normalized))) return { allowed: true };
  const allowed = rules.allowedCommands.length ? rules.allowedCommands.join(" | ") : "nenhum";
  return { allowed: false, reason: `comando fora da lista permitida. Permitidos: ${allowed}` };
}

/** Exact match, except that `{file}` in an allowed command stands for one plain path (no shell syntax). */
function matchesCommand(allowed: string, command: string): boolean {
  if (!allowed.includes("{file}")) return allowed === command;
  const pattern = allowed.split("{file}").map(escapeRegExp).join(`"?[\\w./@-]+"?`);
  return new RegExp(`^${pattern}$`).test(command);
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function collapse(command: string): string {
  return command.trim().replace(/\s+/g, " ");
}
