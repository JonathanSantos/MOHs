import { dirname } from "node:path";
import { normalizePath } from "../util/glob.ts";

/**
 * The project as a human would sketch it for someone new: what it is for, its entities, where it is sensitive and
 * where it bites. Only what is expensive to derive from the code; every claim cites the files it comes from.
 */
export interface Croqui {
  purpose: string;
  entities: { name: string; where: string; what: string }[];
  sensitive: { glob: string; why: string }[];
  pitfalls: { text: string; file: string }[];
  /** Free sections: whatever this project needs said (multi-tenancy, feature flags…), each tied to files. */
  sections: { title: string; text: string; files: string[] }[];
}

/** The croqui a human signed, with the content hash of every cited file at that moment. */
export interface SignedCroqui extends Croqui {
  signedBy: string;
  signedAt: string;
  hash: string;
  cited: Record<string, string>;
}

/** As loaded for a climb: which cited files changed since the signature, so their parts read as possibly outdated. */
export interface LoadedCroqui extends SignedCroqui {
  stale: string[];
}

export function citedFiles(croqui: Croqui): string[] {
  const files = [
    ...croqui.entities.map((entity) => entity.where),
    ...croqui.pitfalls.map((pitfall) => pitfall.file),
    ...croqui.sections.flatMap((section) => section.files),
  ];
  return [...new Set(files.map(normalizePath))];
}

/** What does not hold: a cited file that does not exist, a sensitive glob that matches nothing. */
export function croquiIssues(croqui: Croqui, exists: (file: string) => boolean, matchesAny: (glob: string) => boolean): string[] {
  return [
    ...citedFiles(croqui)
      .filter((file) => !exists(file))
      .map((file) => `${file} não existe no projeto`),
    ...croqui.sensitive.filter(({ glob }) => !matchesAny(glob)).map(({ glob }) => `a área sensível ${glob} não casa com nenhum arquivo`),
  ];
}

export interface CroquiView {
  /** Planning roles read it all; the others, only what touches their files. */
  full: boolean;
  files?: readonly string[];
  stale?: readonly string[];
}

/** The croqui as text, whole or narrowed to the parts near some files, marking what may be outdated. */
export function renderCroqui(croqui: Croqui, { full, files = [], stale = [] }: CroquiView): string {
  const near = (file: string) => full || !files.length || isNear(file, files);
  const mark = (cited: readonly string[]) => {
    const changed = cited.filter((file) => stale.includes(normalizePath(file)));
    return changed.length ? ` (pode estar desatualizado: ${changed.join(", ")} mudou desde a assinatura)` : "";
  };
  const entities = croqui.entities.filter((entity) => near(entity.where));
  const pitfalls = croqui.pitfalls.filter((pitfall) => near(pitfall.file));
  const sections = croqui.sections.filter((section) => section.files.some(near));
  const parts = [croqui.purpose.trim()];
  if (entities.length) {
    parts.push(`Entidades:\n${entities.map((e) => `- ${e.name} (${e.where}): ${e.what}${mark([e.where])}`).join("\n")}`);
  }
  if (croqui.sensitive.length) parts.push(`Áreas sensíveis:\n${croqui.sensitive.map((s) => `- ${s.glob}: ${s.why}`).join("\n")}`);
  if (pitfalls.length) parts.push(`Armadilhas:\n${pitfalls.map((p) => `- ${p.text} (${p.file})${mark([p.file])}`).join("\n")}`);
  for (const section of sections)
    parts.push(`${section.title}${mark(section.files)}:\n${section.text.trim()}\n(${section.files.join(", ")})`);
  return parts.join("\n\n");
}

/** Same file, or same folder as one of the files. */
function isNear(file: string, files: readonly string[]): boolean {
  const target = normalizePath(file);
  return files.some((candidate) => {
    const other = normalizePath(candidate);
    return other === target || dirname(other) === dirname(target);
  });
}
