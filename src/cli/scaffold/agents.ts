import { join } from "node:path";
import type { Platform } from "../../hooks/output.ts";
import { readText, writeText } from "../../util/fs.ts";

/** Tools whose calls the MOHs brake judges; Copilot maps its own names onto these for PascalCase events. */
const GUARDED_TOOLS = "Read|Write|Edit|MultiEdit|NotebookEdit|Glob|Grep|Bash";
const TIMEOUT_S = 15;

interface HookSpec {
  event: "PreToolUse" | "Stop" | "SessionStart";
  command: "pre-tool-use" | "stop" | "session-start";
  matcher?: string;
}

const HOOKS: readonly HookSpec[] = [
  { event: "PreToolUse", command: "pre-tool-use", matcher: GUARDED_TOOLS },
  { event: "Stop", command: "stop" },
  { event: "SessionStart", command: "session-start", matcher: "startup|resume|clear|compact" },
];

export interface Installation {
  /** Files written, relative to the project root. */
  files: string[];
}

type Installer = (projectRoot: string, bin: string, skill: string) => Installation;

/** One installer per agent platform: the skill where the agent finds it, and hooks in the platform's own format. */
export const INSTALLERS: Record<Platform, Installer> = {
  claude(projectRoot, bin, skill) {
    const skillFile = join(".claude", "skills", "mohs", "SKILL.md");
    writeText(join(projectRoot, skillFile), skill);
    const settingsFile = join(".claude", "settings.json");
    const settings = readJson(join(projectRoot, settingsFile));
    const hooks = (settings.hooks ?? {}) as Record<string, unknown[]>;
    for (const spec of HOOKS) {
      const command = `${bin} hook ${spec.command} --for claude`;
      // Reinstalar substitui só as entradas do MOHs; hooks do time ficam como estão.
      const others = (hooks[spec.event] ?? []).filter((group) => !JSON.stringify(group).includes(`hook ${spec.command} --for claude`));
      const group = { ...(spec.matcher ? { matcher: spec.matcher } : {}), hooks: [{ type: "command", command, timeout: TIMEOUT_S }] };
      hooks[spec.event] = [...others, group];
    }
    writeText(join(projectRoot, settingsFile), `${JSON.stringify({ ...settings, hooks }, null, 2)}\n`);
    return { files: [skillFile, settingsFile] };
  },

  copilot(projectRoot, bin, skill) {
    const skillFile = join(".github", "skills", "mohs", "SKILL.md");
    writeText(join(projectRoot, skillFile), skill);
    const hooksFile = join(".github", "hooks", "mohs.json");
    const hooks = Object.fromEntries(
      HOOKS.map((spec) => {
        const command = `${bin} hook ${spec.command} --for copilot`;
        const handler = {
          type: "command",
          ...(spec.matcher ? { matcher: spec.matcher } : {}),
          bash: command,
          powershell: command,
          timeoutSec: TIMEOUT_S,
        };
        return [spec.event, [handler]];
      }),
    );
    writeText(join(projectRoot, hooksFile), `${JSON.stringify({ version: 1, hooks }, null, 2)}\n`);
    return { files: [skillFile, hooksFile] };
  },
};

function readJson(file: string): Record<string, unknown> {
  const text = readText(file);
  if (text === null) return {};
  const data = JSON.parse(text) as unknown;
  if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error(`${file} não é um objeto JSON`);
  return data as Record<string, unknown>;
}
