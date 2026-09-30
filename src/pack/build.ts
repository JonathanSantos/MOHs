import { join } from "node:path";
import { ROLES_DIR } from "../config/paths.ts";
import type { ResolvedConfig } from "../config/types.ts";
import { CROQUI_FILE } from "../config/croqui.ts";
import { renderCroqui } from "../domain/croqui.ts";
import type { PackSummary } from "../domain/events.ts";
import type { Role } from "../domain/types.ts";
import { indexLine, selectBeta, selectSkills, type RackQuery, type RackSelection } from "../rack/select.ts";
import { readText } from "../util/fs.ts";
import { estimateTokens } from "../util/o2.ts";
import { hardnessRules } from "./rules.ts";

export type SectionKind =
  "core" | "hardness" | "skills" | "skill-index" | "beta" | "croqui" | "survey" | "bolts" | "line" | "repro" | "tests" | "task" | "call";

/** Roles that plan the climb read the whole croqui; the others, the parts near their files. */
const PLANNING_ROLES: ReadonlySet<Role> = new Set(["scout", "setter"]);

export interface PackSection {
  kind: SectionKind;
  title: string;
  content: string;
  tokens: number;
  sources: string[];
}

export interface Pack {
  role: RackQuery["role"];
  hardness: RackQuery["hardness"];
  sections: PackSection[];
  tokens: number;
  skills: string[];
  beta: string[];
  overflow: string[];
  rack: RackSelection;
}

export interface PackRequest extends RackQuery {
  survey?: string;
  bolts?: string;
  line?: string;
  /** The route's tests, in a solo climb: written first, visible, and locked by the Basecamp. */
  tests?: string;
  /** The test that reproduces the bug (intent fix), which the send runs. */
  repro?: string;
  /** One agent plays every role: the hardness rules speak of locked tests instead of sealed ones. */
  solo?: boolean;
  task?: string;
  lastCall?: string;
}

/**
 * Assembles the context for one call. Section order never changes and goes from most to least
 * stable, so consecutive calls share a long prefix and hit the provider's prompt cache.
 */
export function buildPack(config: ResolvedConfig, request: PackRequest, rolesDir: string = ROLES_DIR): Pack {
  const sections = new SectionList();
  const coreFile = join(rolesDir, `${request.role}.md`);
  sections.add("core", `Papel: ${request.role}`, readText(coreFile), [coreFile]);
  sections.add("hardness", `Hardness: ${request.hardness}`, hardnessRules(request.hardness, request.role, request.solo));

  const rack = selectSkills(config, request);
  for (const { item } of rack.included) sections.add("skills", `Skill: ${item.name}`, item.body, [item.file]);
  if (rack.indexed.length) {
    sections.add(
      "skill-index",
      "Outras skills disponíveis (peça pelo nome)",
      rack.indexed.map(({ item }) => indexLine(item)).join("\n"),
      rack.indexed.map(({ item }) => item.file),
    );
  }

  const beta = selectBeta(config, request);
  for (const { item } of beta) sections.add("beta", `Beta: ${item.name}`, item.body, [item.file]);

  const { croqui } = config;
  if (croqui) {
    const full = PLANNING_ROLES.has(request.role);
    const text = renderCroqui(croqui, { full, files: request.files, stale: croqui.stale });
    sections.add("croqui", full ? "Croqui do projeto" : "Croqui do projeto (o que toca estes arquivos)", text, [CROQUI_FILE]);
  }
  sections.add("survey", "Survey", request.survey);
  sections.add("bolts", "Bolts", request.bolts);
  sections.add("line", "Line", request.line);
  sections.add("repro", "Teste que reproduz o bug (falha hoje; o Basecamp o roda no send e o adota no fim)", request.repro);
  sections.add("tests", "Testes da route (travados: o Basecamp roda a cópia dele no send)", request.tests);
  sections.add("task", "Pitch", request.task);
  sections.add("call", "Última call", request.lastCall);

  return {
    role: request.role,
    hardness: request.hardness,
    sections: sections.items,
    tokens: sections.tokens,
    skills: rack.included.map(({ item }) => item.name),
    beta: beta.map(({ item }) => item.name),
    overflow: rack.overflow.map(({ item }) => item.name),
    rack,
  };
}

export function summarizePack(pack: Pack): PackSummary {
  return { tokens: pack.tokens, skills: pack.skills, beta: pack.beta, overflow: pack.overflow };
}

/** Final text sent to the model. */
export function renderPack(pack: Pack): string {
  return renderSections(pack.sections);
}

/** Sections that change on every task; everything before them is a stable, cacheable prefix. */
const VOLATILE_SECTIONS: ReadonlySet<SectionKind> = new Set(["task", "call"]);

/** Stable sections become the brief (cached by providers); the task and the last call become the assignment. */
export function splitPack(pack: Pack): { brief: string; assignment: string } {
  return {
    brief: renderSections(pack.sections.filter((section) => !VOLATILE_SECTIONS.has(section.kind))),
    assignment: renderSections(pack.sections.filter((section) => VOLATILE_SECTIONS.has(section.kind))),
  };
}

/** Adds what went wrong last time as a closing section, so the next attempt does not repeat it. */
export function withFeedback(pack: Pack, feedback: string | undefined): Pack {
  const content = feedback?.trim();
  if (!content) return pack;
  const note: PackSection = { kind: "call", title: "Da tentativa anterior", content, tokens: estimateTokens(content), sources: [] };
  return { ...pack, sections: [...pack.sections, note], tokens: pack.tokens + note.tokens };
}

function renderSections(sections: readonly PackSection[]): string {
  return sections.map((section) => `## ${section.title}\n\n${section.content}`).join("\n\n");
}

class SectionList {
  readonly items: PackSection[] = [];

  get tokens(): number {
    return this.items.reduce((sum, section) => sum + section.tokens, 0);
  }

  add(kind: SectionKind, title: string, content: string | null | undefined, sources: string[] = []): void {
    const text = content?.trim();
    if (text) this.items.push({ kind, title, content: text, tokens: estimateTokens(text), sources });
  }
}
