import { isAbsolute, resolve } from "node:path";

export const HOOK_EVENTS = ["pre-tool-use", "stop", "session-start"] as const;
export type HookEvent = (typeof HOOK_EVENTS)[number];

/** A tool call as the policy sees it, whatever agent sent it. */
export interface ToolUse {
  name: string;
  kind: "read" | "write" | "exec" | "other";
  /** Absolute paths the call touches. */
  paths: string[];
  command?: string;
}

export interface HookInput {
  cwd: string;
  tool?: ToolUse;
}

/**
 * Tool names from Claude Code (PascalCase) and Copilot (camelCase and its Claude-compatible mapping).
 * Unknown tools are "other" and always allowed: a hook must never break a tool it does not understand.
 */
const TOOL_KINDS: Record<string, ToolUse["kind"]> = {
  read: "read",
  view: "read",
  glob: "read",
  grep: "read",
  rg: "read",
  ls: "read",
  write: "write",
  create: "write",
  edit: "write",
  multiedit: "write",
  notebookedit: "write",
  str_replace_editor: "write",
  apply_patch: "write",
  bash: "exec",
  shell: "exec",
  powershell: "exec",
};

const PATH_FIELDS = ["file_path", "filePath", "path", "notebook_path", "notebookPath"];
/** Files named inside a patch (Codex and Copilot `apply_patch`). */
const PATCH_FILE = /^\*\*\* (?:Add|Update|Delete) File: (.+)$/gm;

/** Reads the hook payload of Claude Code or Copilot (snake_case or camelCase) into one shape. */
export function readHookInput(raw: unknown, fallbackCwd: string): HookInput {
  const data = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const cwd = typeof data.cwd === "string" && data.cwd ? data.cwd : fallbackCwd;
  const name = String(data.tool_name ?? data.toolName ?? "");
  if (!name) return { cwd };

  const args = parseArgs(data.tool_input ?? data.toolArgs);
  const paths = PATH_FIELDS.flatMap((field) => (typeof args[field] === "string" ? [args[field] as string] : []));
  for (const text of [args.patch, args.input, args.command].filter((value): value is string => typeof value === "string")) {
    for (const match of text.matchAll(PATCH_FILE)) paths.push(match[1].trim());
  }
  const command = typeof args.command === "string" ? args.command : undefined;
  return {
    cwd,
    tool: {
      name,
      kind: TOOL_KINDS[name.toLowerCase()] ?? "other",
      paths: paths.map((path) => (isAbsolute(path) ? path : resolve(cwd, path))),
      command,
    },
  };
}

function parseArgs(value: unknown): Record<string, unknown> {
  if (typeof value === "string") {
    try {
      return parseArgs(JSON.parse(value));
    } catch {
      return {};
    }
  }
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}
