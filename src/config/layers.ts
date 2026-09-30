import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import { isDir } from "../util/fs.ts";
import { readChecks, readLayerItems } from "./items.ts";
import { BRAKE_FILE, CONFIG_FILE, GUIDEBOOKS_DIR } from "./paths.ts";
import { brakeYamlSchema, mohsYamlSchema, type BrakeYaml, type MohsYaml } from "./schema.ts";
import type { CheckRef, Diagnostic, LayerInfo, LayerKind, RackItem } from "./types.ts";
import { readYamlFile } from "./yaml.ts";

export interface Layer extends LayerInfo {
  mohs?: MohsYaml;
  brake?: BrakeYaml;
  items: RackItem[];
  checks: CheckRef[];
}

export function readLayer(kind: LayerKind, label: string, dir: string, diagnostics: Diagnostic[]): Layer {
  return {
    kind,
    label,
    dir,
    mohs: readYamlFile(join(dir, CONFIG_FILE), mohsYamlSchema, diagnostics),
    brake: readYamlFile(join(dir, BRAKE_FILE), brakeYamlSchema, diagnostics),
    items: readLayerItems(dir, label, diagnostics),
    checks: readChecks(dir, label),
  };
}

export function overrideLayer(dir: string, overrides: MohsYaml): Layer {
  return { kind: "override", label: "flags", dir, mohs: overrides, items: [], checks: [] };
}

/**
 * Resolves `extends` depth-first: every guidebook comes right before the layer that extends it,
 * so the layer always has the last word. Guidebooks load once; cycles become diagnostics.
 */
export class ExtendsResolver {
  private readonly loading: string[] = [];
  private readonly loaded = new Set<string>();
  private readonly projectRoot: string;
  private readonly diagnostics: Diagnostic[];

  constructor(projectRoot: string, diagnostics: Diagnostic[]) {
    this.projectRoot = projectRoot;
    this.diagnostics = diagnostics;
  }

  expand(layer: Layer): Layer[] {
    const ordered: Layer[] = [];
    this.loading.push(layer.dir);
    for (const spec of layer.mohs?.extends ?? []) {
      const guidebook = this.load(spec, layer);
      if (guidebook) ordered.push(...this.expand(guidebook));
    }
    this.loading.pop();
    ordered.push(layer);
    return ordered;
  }

  private load(spec: string, from: Layer): Layer | null {
    const file = join(from.dir, CONFIG_FILE);
    const dir = resolveGuidebook(spec, from.dir, this.projectRoot);
    if (!dir) {
      this.diagnostics.push({ level: "error", file, message: `extends: guidebook não encontrado: ${spec}` });
      return null;
    }
    if (this.loading.includes(dir)) {
      this.diagnostics.push({ level: "error", file, message: `extends circular: ${spec} já está sendo carregado` });
      return null;
    }
    if (this.loaded.has(dir)) return null;
    this.loaded.add(dir);
    return readLayer("guidebook", spec, dir, this.diagnostics);
  }
}

/**
 * `mohs:<name>` → guidebook bundled with MOHs; `~/…` → home folder; relative or absolute path →
 * relative to the file that declares it; anything else → package under node_modules.
 */
export function resolveGuidebook(spec: string, baseDir: string, projectRoot: string): string | null {
  const dir = spec.startsWith("mohs:")
    ? join(GUIDEBOOKS_DIR, spec.slice("mohs:".length))
    : /^~[/\\]/.test(spec)
      ? join(homedir(), spec.slice(2))
      : spec.startsWith(".") || isAbsolute(spec)
        ? resolve(baseDir, spec)
        : join(projectRoot, "node_modules", spec);
  return isDir(dir) ? resolve(dir) : null;
}
