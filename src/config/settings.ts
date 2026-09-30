import { HARDNESS, ROLES, type Hardness, type Role } from "../domain/types.ts";
import { parseO2 } from "../util/o2.ts";
import type { MohsYaml } from "./schema.ts";
import type { RackRoleSettings, Settings } from "./types.ts";

/** Safety net for when the core layer is missing; the real defaults live in core/mohs.yaml. */
const FALLBACK = {
  model: "claude-sonnet-5-5",
  port: 4747,
  commandTimeoutS: 600,
  agents: { maxTurns: 40, effort: "medium", fallbacks: true, maxO2PerTask: 300_000 } satisfies Settings["agents"],
  rackO2: {
    scout: 2_000,
    reproducer: 4_000,
    setter: 4_000,
    belayer: 6_000,
    climber: 8_000,
    inspector: 3_000,
    scribe: 3_000,
  } satisfies Record<Role, number>,
  hardnessO2: { talc: 30_000, fluorite: 60_000, quartz: 400_000, diamond: 1_200_000 } satisfies Record<Hardness, number>,
  testsPerScenario: { talc: 1, fluorite: 1, quartz: 3, diamond: 5 } satisfies Record<Hardness, number>,
  talc: { maxFiles: 3, maxLines: 120, sensitive: [] as string[] },
};

export function toSettings(yaml: MohsYaml): Settings {
  return {
    commands: {
      anchor: yaml.commands?.anchor ?? [],
      send: yaml.commands?.send ?? [],
      e2e: yaml.commands?.e2e ?? [],
      seal: yaml.commands?.seal,
      sealE2e: yaml.commands?.seal_e2e,
      dev: yaml.commands?.dev,
      timeoutMs: (yaml.commands?.timeout_s ?? FALLBACK.commandTimeoutS) * 1000,
    },
    providers: toProviders(yaml),
    agents: {
      maxTurns: yaml.agents?.max_turns ?? FALLBACK.agents.maxTurns,
      effort: yaml.agents?.effort ?? FALLBACK.agents.effort,
      fallbacks: yaml.agents?.fallbacks ?? FALLBACK.agents.fallbacks,
      maxO2PerTask: yaml.agents?.max_o2_per_task === undefined ? FALLBACK.agents.maxO2PerTask : parseO2(yaml.agents.max_o2_per_task),
    },
    tools: { commands: yaml.tools?.commands ?? [] },
    models: toModels(yaml),
    rack: { sources: yaml.rack?.sources ?? [], roles: toRackRoles(yaml) },
    hardness: toHardness(yaml),
    talc: {
      maxFiles: yaml.talc?.max_files ?? FALLBACK.talc.maxFiles,
      maxLines: yaml.talc?.max_lines ?? FALLBACK.talc.maxLines,
      sensitive: yaml.talc?.sensitive ?? FALLBACK.talc.sensitive,
    },
    lookout: { port: yaml.lookout?.port ?? FALLBACK.port },
  };
}

function toProviders(yaml: MohsYaml): Settings["providers"] {
  const providers: Settings["providers"] = {};
  for (const [name, declared] of Object.entries(yaml.providers ?? {})) {
    providers[name] = { type: declared.type, baseUrl: declared.base_url, apiKeyEnv: declared.api_key_env };
  }
  return providers;
}

function toModels(yaml: MohsYaml): Settings["models"] {
  const models = {} as Settings["models"];
  for (const role of [...ROLES, "crux"] as const) models[role] = yaml.models?.[role] ?? FALLBACK.model;
  return models;
}

function toRackRoles(yaml: MohsYaml): Record<Role, RackRoleSettings> {
  const roles = {} as Record<Role, RackRoleSettings>;
  for (const role of ROLES) {
    const declared = yaml.rack?.[role];
    roles[role] = {
      always: declared?.always ?? [],
      exclude: declared?.exclude ?? [],
      o2: declared?.o2 === undefined ? FALLBACK.rackO2[role] : parseO2(declared.o2),
    };
  }
  return roles;
}

function toHardness(yaml: MohsYaml): Settings["hardness"] {
  const hardness = {} as Settings["hardness"];
  for (const level of HARDNESS) {
    const declared = yaml.hardness?.[level];
    hardness[level] = {
      o2: declared?.o2 === undefined ? FALLBACK.hardnessO2[level] : parseO2(declared.o2),
      testsPerScenario: declared?.tests_per_scenario ?? FALLBACK.testsPerScenario[level],
    };
  }
  return hardness;
}
