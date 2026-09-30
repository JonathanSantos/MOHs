import { join } from "node:path";
import { applyProposal } from "../../beta/apply.ts";
import { EVENTS_FILE, EventLog, readEvents } from "../../basecamp/event-log.ts";
import { Journal } from "../../basecamp/journal.ts";
import { mohsDirOf } from "../../config/paths.ts";
import { project } from "../../view/reducer.ts";
import type { ProposalView } from "../../view/types.ts";
import { CLIMB_FLAG, NO_CLIMB, resolveClimbDir } from "../climb-dir.ts";
import { defineCommand } from "../command.ts";
import { fail, ink, print } from "../terminal.ts";

const STATUS: Record<ProposalView["status"], string> = { pending: "pendente", accepted: "aceita", rejected: "recusada" };

export const betaCommand = defineCommand({
  name: "beta",
  args: "[accept|reject <id>]",
  summary: "mostra as propostas do scribe; accept escreve a proposta em .mohs/, reject a descarta",
  flags: CLIMB_FLAG,

  run({ projectRoot, args: [action, id], flags }) {
    const dir = resolveClimbDir(projectRoot, flags.climb);
    if (!dir) return fail(NO_CLIMB);
    const events = readEvents(join(dir, EVENTS_FILE));
    const view = project(events);
    if (!action) return list(view.proposals);

    const proposal = view.proposals.find((p) => p.id === id);
    if (action !== "accept" && action !== "reject") return fail("use: mohs beta [accept|reject <id>]");
    if (!proposal) return fail(`proposta desconhecida: ${id ?? "(sem id)"}. Veja as propostas com mohs beta`);
    if (proposal.status !== "pending") return fail(`${proposal.id} já foi ${STATUS[proposal.status]}`);

    const journal = new Journal(new EventLog(view.id, dir));
    if (action === "reject") {
      journal.record("beta.rejected", { id: proposal.id }, { actor: "human" });
      print(`${ink.dim("recusada")} · ${proposal.id}`);
      return 0;
    }
    const applied = applyProposal(mohsDirOf(projectRoot), projectRoot, proposal, view.id);
    journal.record("beta.accepted", { id: proposal.id, file: "file" in applied ? applied.file : undefined }, { actor: "human" });
    if ("file" in applied) {
      print(`${ink.ok("aceita")} · ${proposal.id} → ${applied.file}`, `Confira com ${ink.rope("mohs doctor")}.`);
    } else {
      print(`${ink.ok("aceita")} · ${proposal.id} · mudança de configuração: aplique à mão no .mohs/mohs.yaml`, "", applied.manual);
    }
    return 0;
  },
});

function list(proposals: readonly ProposalView[]): number {
  if (!proposals.length) {
    print("Nenhuma proposta neste climb. O scribe propõe no descent, em quartz e diamond.");
    return 0;
  }
  for (const p of proposals) {
    print(
      `${ink.bold(p.id)} · ${p.kind} · ${p.target} · ${STATUS[p.status]}${p.file ? ` → ${p.file}` : ""}`,
      `  ${p.summary}`,
      ink.dim(`  evidência: ${p.evidence.join("; ")}`),
    );
  }
  print("", `Aceite com ${ink.rope("mohs beta accept <id>")} ou descarte com ${ink.rope("mohs beta reject <id>")}.`);
  return 0;
}
