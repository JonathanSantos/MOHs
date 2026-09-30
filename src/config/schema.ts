import { HARDNESS, ROLES, SEVERITIES } from "../domain/types.ts";
import { z } from "../util/zod.ts";

const hardness = z.enum(HARDNESS);
/** A command that runs one test file: `{file}` marks where the path goes. */
const fileCommand = z.string().refine((command) => command.includes("{file}"), "use {file} onde entra o caminho do arquivo de teste");
const role = z.enum(ROLES);
const severity = z.enum(SEVERITIES);
const o2 = z.union([z.number().int().positive(), z.string().regex(/^\d+([.,]\d+)?\s*[kKmM]?$/, "use um número ou algo como 8k, 1.2M")]);
const kebabName = z.string().regex(/^[a-z0-9][a-z0-9-]*$/, "use letras minúsculas, números e hífen");

const rackRole = z.strictObject({
  always: z.array(z.string()).optional(),
  exclude: z.array(z.string()).optional(),
  o2: o2.optional(),
});

const perRole = <T extends z.ZodType>(schema: T) =>
  z.strictObject({
    scout: schema.optional(),
    reproducer: schema.optional(),
    setter: schema.optional(),
    belayer: schema.optional(),
    climber: schema.optional(),
    inspector: schema.optional(),
    scribe: schema.optional(),
  });

const perHardness = <T extends z.ZodType>(schema: T) =>
  z.strictObject({ talc: schema.optional(), fluorite: schema.optional(), quartz: schema.optional(), diamond: schema.optional() });

const provider = z.strictObject({
  type: z.enum(["anthropic", "openai-compatible"]),
  base_url: z.url().optional(),
  api_key_env: z
    .string()
    .regex(/^[A-Z_][A-Z0-9_]*$/, "use o nome de uma variável de ambiente, ex.: MOONSHOT_API_KEY")
    .optional(),
});

export const mohsYamlSchema = z.strictObject({
  extends: z.array(z.string()).optional(),
  commands: z
    .strictObject({
      anchor: z.array(z.string()).optional(),
      send: z.array(z.string()).optional(),
      e2e: z.array(z.string()).optional(),
      seal: fileCommand.optional(),
      seal_e2e: fileCommand.optional(),
      dev: z.string().optional(),
      timeout_s: z.number().int().positive().optional(),
    })
    .optional(),
  providers: z.record(z.string().regex(/^[a-z0-9-]+$/), provider).optional(),
  agents: z
    .strictObject({
      max_turns: z.number().int().min(1).max(200).optional(),
      effort: z.enum(["low", "medium", "high", "xhigh", "max"]).optional(),
      fallbacks: z.boolean().optional(),
      max_o2_per_task: o2.optional(),
    })
    .optional(),
  tools: z.strictObject({ commands: z.array(z.string()).optional() }).optional(),
  models: perRole(z.string()).extend({ crux: z.string().optional() }).optional(),
  rack: perRole(rackRole)
    .extend({ sources: z.array(z.string()).optional() })
    .optional(),
  hardness: perHardness(z.strictObject({ o2: o2.optional(), tests_per_scenario: z.number().int().min(1).optional() })).optional(),
  talc: z
    .strictObject({
      max_files: z.number().int().min(1).optional(),
      max_lines: z.number().int().min(1).optional(),
      sensitive: z.array(z.string()).optional(),
    })
    .optional(),
  lookout: z.strictObject({ port: z.number().int().min(1).max(65535).optional() }).optional(),
});
export type MohsYaml = z.infer<typeof mohsYamlSchema>;

export const brakeYamlSchema = z.strictObject({
  block: z.array(severity).optional(),
  warn: z.array(severity).optional(),
  ignore: z.array(severity).optional(),
  min_confidence: z.number().min(0).max(100).optional(),
  falls_before_rescue: z.number().int().min(1).optional(),
  inspection_rounds: z.number().int().min(1).optional(),
});
export type BrakeYaml = z.infer<typeof brakeYamlSchema>;

const when = z.strictObject({
  files: z.array(z.string()).optional(),
  hardness: z.array(hardness).optional(),
  tags: z.array(z.string()).optional(),
});

/** Loose objects: skills written for Claude Code or Copilot carry extra fields we simply ignore. */
export const skillSchema = z.looseObject({
  name: kebabName,
  description: z.string().min(1),
  roles: z.array(role).optional(),
  when: when.optional(),
  load: z.enum(["always", "match", "index"]).optional(),
  priority: z.number().optional(),
});

export const betaSchema = z.looseObject({
  name: kebabName.optional(),
  description: z.string().optional(),
  roles: z.array(role).optional(),
  when: when.optional(),
  load: z.enum(["always", "match"]).optional(),
  priority: z.number().optional(),
});

export const inspectorSchema = z.looseObject({
  name: kebabName,
  description: z.string().min(1),
  when: z.strictObject({ files: z.array(z.string()).optional() }).optional(),
  hardness: z.array(hardness).optional(),
  model: z.string().optional(),
  tests: z.boolean().optional(),
});
