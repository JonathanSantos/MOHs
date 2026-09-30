import { resolve } from "node:path";
import { ROLES } from "../domain/types.ts";
import { isDir } from "../util/fs.ts";
import { toBrakePolicy } from "./brake-policy.ts";
import { readSkillsFrom } from "./items.ts";
import { ExtendsResolver, overrideLayer, readLayer, type Layer } from "./layers.ts";
import { deepMerge, mergeChecks, mergeItems } from "./merge.ts";
import { CORE_DIR, defaultUserDir, mohsDirOf } from "./paths.ts";
import type { BrakeYaml, MohsYaml } from "./schema.ts";
import { toSettings } from "./settings.ts";
import { readCroqui } from "./croqui.ts";
import type { Diagnostic, ResolvedConfig, Settings } from "./types.ts";

export interface LoadOptions {
  projectRoot: string;
  /** User preferences folder. `null` disables it; default: $MOHS_HOME or ~/.mohs. */
  userDir?: string | null;
  overrides?: MohsYaml;
  coreDir?: string;
}

/**
 * Builds the effective configuration from its layers, weakest first:
 * core → guidebooks (extends) → ~/.mohs → skills from other tools → .mohs → CLI flags.
 */
export function loadConfig(options: LoadOptions): ResolvedConfig {
  const projectRoot = resolve(options.projectRoot);
  const mohsDir = mohsDirOf(projectRoot);
  const diagnostics: Diagnostic[] = [];

  const layers = collectLayers({ ...options, projectRoot }, mohsDir, diagnostics);
  const settings = toSettings(layers.reduce<MohsYaml>((merged, layer) => deepMerge(merged, withoutExtends(layer.mohs)), {}));
  const ordered = withSkillSources(layers, settings, projectRoot, diagnostics);
  const items = mergeItems(ordered, diagnostics);

  const config: ResolvedConfig = {
    projectRoot,
    mohsDir,
    layers: ordered.map(({ kind, label, dir }) => ({ kind, label, dir })),
    settings,
    brake: toBrakePolicy(
      ordered.reduce<BrakeYaml>((merged, layer) => deepMerge(merged, layer.brake), {}),
      diagnostics,
    ),
    skills: items.filter((item) => item.kind === "skill"),
    beta: items.filter((item) => item.kind === "beta"),
    inspectors: items.filter((item) => item.kind === "inspector"),
    checks: mergeChecks(ordered),
    croqui: readCroqui(mohsDir, projectRoot, diagnostics),
    diagnostics,
  };
  warnAboutRackReferences(config);
  return config;
}

function collectLayers(options: LoadOptions, mohsDir: string, diagnostics: Diagnostic[]): Layer[] {
  const resolver = new ExtendsResolver(options.projectRoot, diagnostics);
  const layers = [readLayer("core", "núcleo", options.coreDir ?? CORE_DIR, diagnostics)];

  const userDir = options.userDir === undefined ? defaultUserDir() : options.userDir;
  if (userDir && isDir(userDir) && resolve(userDir) !== mohsDir) {
    layers.push(...resolver.expand(readLayer("user", "~/.mohs", userDir, diagnostics)));
  }
  if (isDir(mohsDir)) layers.push(...resolver.expand(readLayer("project", ".mohs", mohsDir, diagnostics)));
  if (options.overrides) layers.push(overrideLayer(options.projectRoot, options.overrides));
  return layers;
}

/** Skills from other tools (e.g. .claude/skills) enter right before the project, so .mohs/rack still wins. */
function withSkillSources(layers: Layer[], settings: Settings, projectRoot: string, diagnostics: Diagnostic[]): Layer[] {
  const sources: Layer[] = [];
  for (const source of settings.rack.sources) {
    const dir = resolve(projectRoot, source);
    if (!isDir(dir)) {
      diagnostics.push({ level: "warn", message: `rack.sources: pasta não encontrada: ${source}` });
      continue;
    }
    sources.push({ kind: "source", label: source, dir, items: readSkillsFrom(dir, source, diagnostics), checks: [] });
  }
  const projectIndex = layers.findIndex((layer) => layer.kind === "project");
  const insertAt = projectIndex === -1 ? layers.length : projectIndex;
  return [...layers.slice(0, insertAt), ...sources, ...layers.slice(insertAt)];
}

function warnAboutRackReferences(config: ResolvedConfig): void {
  const skills = new Map(config.skills.map((skill) => [skill.name, skill]));
  for (const role of ROLES) {
    for (const name of config.settings.rack.roles[role].always) {
      const skill = skills.get(name);
      if (!skill) config.diagnostics.push({ level: "warn", message: `rack.${role}.always: skill "${name}" não existe` });
      else if (!skill.roles.includes(role))
        config.diagnostics.push({ level: "warn", message: `rack.${role}.always: a skill "${name}" não lista "${role}" em roles` });
    }
  }
}

function withoutExtends(yaml: MohsYaml | undefined): MohsYaml {
  if (!yaml) return {};
  const { extends: _extends, ...rest } = yaml;
  return rest;
}
