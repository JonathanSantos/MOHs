import { join } from "node:path";
import type { Role } from "../../domain/types.ts";
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

/**
 * The subagents an orchestrating agent creates, one per role: each gets only the tools its role needs, so it starts
 * with far less context than a general-purpose agent. The planner takes the scout and the setter tasks in sequence:
 * both only read, and whoever explored the project for the plan already knows it for the line.
 */
interface RoleAgent {
  name: string;
  roles: readonly Role[];
  writes: boolean;
  what: string;
  how: string;
}

export const ROLE_AGENTS: readonly RoleAgent[] = [
  {
    name: "mohs-planner",
    roles: ["scout", "setter"],
    writes: false,
    what: "planeja o climb: o plano do scout, a line e os bolts do setter",
    how: "Faça o scout (`--role scout`) e depois a line (`--role setter`), com o mesmo nome. Na vez do humano, pare; depois da assinatura, quem te criou te retoma para os bolts (`--role setter`).",
  },
  {
    name: "mohs-reproducer",
    roles: ["reproducer"],
    writes: true,
    what: "prova um bug num teste que falha hoje, antes de alguém planejar a correção",
    how: "Escreva o teste no diretório da tarefa (um checkout descartável) e não corrija nada. O teste fica visível para quem corrige.",
  },
  {
    name: "mohs-belayer",
    roles: ["belayer"],
    writes: true,
    what: "escreve os testes da route antes do código e explica as falls ao climber",
    how: "Os seus testes são selados: nada do que você escreveu, nem a saída deles, vai para quem implementa. O climber sobe enquanto você escreve; o send espera por você.",
  },
  {
    name: "mohs-climber",
    roles: ["climber"],
    writes: true,
    what: "implementa os pitches de uma route, no worktree dela",
    how: "Suba os pitches em sequência: a saída de cada `safe` traz o próximo. Uma route depois da outra pode ser sua; routes em paralelo são de climbers diferentes.",
  },
  {
    name: "mohs-inspector",
    roles: ["inspector"],
    writes: false,
    what: "revisa o diff de uma route com a rubrica da tarefa, sem ter escrito o código",
    how: "Com várias inspeções abertas, pegue a sua pelo `--task <id>` que quem te criou passou.",
  },
  {
    name: "mohs-scribe",
    roles: ["scribe"],
    writes: false,
    what: "lê o atrito do climb e propõe beta para os próximos",
    how: "Proponha só o que o atrito deste climb sustenta; nada é aplicado sem um humano escolher.",
  },
];

/** Tool names per platform: read, search and a shell for every role; editing only for the roles that write. */
const AGENT_TOOLS: Record<Platform, { base: string[]; write: string[] }> = {
  claude: { base: ["Read", "Grep", "Glob", "Bash"], write: ["Edit", "Write"] },
  copilot: { base: ["read", "search", "execute"], write: ["edit"] },
};

/** The rules every role follows: the skill's own "Regras" section, so they are written once. */
function skillRules(skill: string): string {
  const start = skill.indexOf("## Regras");
  return start >= 0 ? skill.slice(start).trim() : "";
}

/** The agent file of one role, in the platform's format (frontmatter + instructions). */
export function roleAgentFile(platform: Platform, agent: RoleAgent, skill: string, bin: string): string {
  const tools = [...AGENT_TOOLS[platform].base, ...(agent.writes ? AGENT_TOOLS[platform].write : [])];
  const roles = agent.roles.map((role) => `\`--role ${role}\``).join(" e ");
  const description = `Subagente do MOHs que ${agent.what}. Use nas tarefas de ${agent.roles.join(" e ")} de um climb do MOHs.`;
  const frontmatter =
    platform === "claude"
      ? [`name: ${agent.name}`, `description: ${description}`, `tools: ${tools.join(", ")}`]
      : [`name: ${agent.name}`, `description: ${description}`, `tools: [${tools.map((tool) => `"${tool}"`).join(", ")}]`];
  return [
    "---",
    ...frontmatter,
    "---",
    "",
    `Você é o ${agent.name} de um climb do MOHs: ${agent.what}.`,
    "",
    `Quem te criou diz o seu nome, a route (quando houver) e o comando do MOHs (\`${bin}\`, se não disser outro). Pegue cada tarefa com \`mohs next\` (${roles}, \`--as <seu nome>\`) e termine com o \`mohs call\` que ela lista, com o mesmo \`--as\`. ${agent.how}`,
    "",
    "Pare quando a saída disser que é a vez do humano, que a próxima tarefa é de outro papel ou que o climb terminou, e relate a quem te criou exatamente o que ela disse.",
    "",
    skillRules(skill),
    "",
  ].join("\n");
}

/** Where each platform looks for custom agents. */
const AGENT_DIRS: Record<Platform, (name: string) => string> = {
  claude: (name) => join(".claude", "agents", `${name}.md`),
  copilot: (name) => join(".github", "agents", `${name}.agent.md`),
};

function writeRoleAgents(platform: Platform, projectRoot: string, bin: string, skill: string): string[] {
  return ROLE_AGENTS.map((agent) => {
    const file = AGENT_DIRS[platform](agent.name);
    writeText(join(projectRoot, file), roleAgentFile(platform, agent, skill, bin));
    return file;
  });
}

/** One installer per agent platform: the skill, the role agents and the hooks, each in the platform's own format. */
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
    return { files: [skillFile, ...writeRoleAgents("claude", projectRoot, bin, skill), settingsFile] };
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
    return { files: [skillFile, ...writeRoleAgents("copilot", projectRoot, bin, skill), hooksFile] };
  },
};

function readJson(file: string): Record<string, unknown> {
  const text = readText(file);
  if (text === null) return {};
  const data = JSON.parse(text) as unknown;
  if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error(`${file} não é um objeto JSON`);
  return data as Record<string, unknown>;
}
