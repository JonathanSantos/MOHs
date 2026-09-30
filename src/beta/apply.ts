import { basename, join, relative } from "node:path";
import type { Proposal } from "../domain/types.ts";
import { readText, writeText } from "../util/fs.ts";
import { normalizePath } from "../util/glob.ts";

export type Applied = { file: string } | { manual: string };

type Writer = (mohsDir: string, name: string) => string;

/** Where each kind of proposal lands in `.mohs/`. A config change is never written for the human: it is shown. */
const PLACES: Record<Exclude<Proposal["kind"], "config">, Writer> = {
  beta: (mohsDir, name) => join(mohsDir, "beta", `${name}.md`),
  skill: (mohsDir, name) => join(mohsDir, "rack", name, "SKILL.md"),
  inspector: (mohsDir, name) => join(mohsDir, "inspectors", `${name}.md`),
};

/**
 * Writes an accepted proposal as an extension file, with frontmatter the config loader accepts and the evidence
 * that motivated it. If the file already exists, the text is added at the end instead of replacing it.
 */
export function applyProposal(mohsDir: string, projectRoot: string, proposal: Proposal, climbId: string): Applied {
  if (proposal.kind === "config") return { manual: proposal.content ?? proposal.summary };
  const file = PLACES[proposal.kind](mohsDir, nameOf(proposal.target));
  const body = (proposal.content ?? proposal.summary).trim();
  const evidence = `<!-- MOHs · ${proposal.id} do climb ${climbId} · evidência: ${proposal.evidence.join("; ")} -->`;
  const existing = readText(file);
  if (existing !== null) {
    writeText(file, `${existing.trimEnd()}\n\n${body}\n\n${evidence}\n`);
  } else {
    const frontmatter = [`name: ${nameOf(proposal.target)}`, `description: ${JSON.stringify(proposal.summary)}`];
    writeText(file, `---\n${frontmatter.join("\n")}\n---\n\n${body}\n\n${evidence}\n`);
  }
  return { file: normalizePath(relative(projectRoot, file)) };
}

/** `.mohs/beta/titulos.md`, `rack/titulos/SKILL.md` or plain words → `titulos`: a kebab-case name the loader accepts. */
function nameOf(target: string): string {
  const parts = normalizePath(target).split("/").filter(Boolean);
  const last = parts.at(-1) === "SKILL.md" ? (parts.at(-2) ?? "proposta") : basename(parts.at(-1) ?? "proposta");
  const name = last
    .replace(/\.md$/i, "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return name || "proposta";
}
