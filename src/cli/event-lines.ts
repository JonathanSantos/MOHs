import { summarizeCall } from "../domain/calls.ts";
import type { EventType, MohsEvent } from "../domain/events.ts";
import { describeEvidence, type EvidenceGrade } from "../domain/evidence.ts";
import { describeWindows } from "../domain/plan.ts";
import type { Severity } from "../domain/types.ts";
import { formatO2 } from "../util/o2.ts";
import type { ClimbView } from "../view/types.ts";
import { hardnessLabel, ink, row } from "./terminal.ts";

const EVIDENCE_TONE: Record<EvidenceGrade, (text: string) => string> = {
  forte: ink.ok,
  média: ink.ok,
  fraca: ink.warn,
  nenhuma: ink.crit,
};

type LineWriter<K extends EventType> = (event: MohsEvent<K>, view: ClimbView) => string | string[] | null;
type LineWriters = { [K in EventType]?: LineWriter<K> };

/** How each event reads in the terminal. Events without a writer stay silent. */
const WRITERS: LineWriters = {
  "scout.hardness": ({ data }) => [
    row("scout", `${data.kind === "variation" ? "variation" : "first ascent"} · ${data.routes.length} routes · ${data.reason}`),
    row("hardness", `${hardnessLabel(data.hardness)} · cilindro de ${formatO2(data.budget)}`),
    ...data.routes.map((route) =>
      row("", `${ink.bold(route.id)} ${route.name} · ${hardnessLabel(route.hardness)} · ${route.pitches.length} pitches`),
    ),
  ],
  "scout.escalated": ({ route, data }) =>
    row("hardness", `route ${route} · ${data.from} → ${hardnessLabel(data.to)} · ${data.reason}`, ink.warn),
  "survey.ready": ({ data }) => row("survey", `${data.files} arquivos · ${data.kind === "variation" ? "variation" : "first ascent"}`),
  "route.started": ({ route, data }) => (data.branch ? row("route", `${route} · worktree na branch ${data.branch}`) : null),
  "line.drafted": ({ data }) =>
    row("line", `pronta para assinar (${data.hash.slice(0, 7)}) → ${ink.rope("mohs sign")} ou no Lookout`, ink.warn),
  "line.signed": ({ data }) => row("line", `assinada por ${data.by}`, ink.ok),
  "signature.requested": ({ data }) =>
    row("sign", `${data.what}: revise ${data.review} → ${ink.rope(`mohs sign ${data.target}`)}`, ink.warn),
  "signature.given": ({ data }) => row("sign", `${data.target} assinado por ${data.by}`, ink.ok),
  "bolts.set": ({ route }) => row("bolts", `route ${route}`),
  "seal.red": ({ route, data }) => row("seal", `route ${route} · ${data.total} testes selados, todos vermelhos`),
  "seal.disputed": ({ route, data }) => row("dispute", `route ${route} · o climber contesta a FALL com a line: ${data.argument}`, ink.warn),
  "seal.upheld": ({ route, actor, data }) => row("upheld", `route ${route} · ${actor} manteve o teste: ${data.reason}`),
  "seal.amended": ({ route, data }) => row("amended", `route ${route} · o belayer corrigiu o teste: ${data.reason}`, ink.warn),
  "decisions.taken": ({ route, data }) =>
    row("decisions", `route ${route} · ${data.decisions.join(" · ")} (o humano confirma no summit)`, ink.warn),
  "croqui.drafted": ({ data }) =>
    row(
      "croqui",
      `pronto para assinar: ${data.entities} entidade(s), ${data.sections} seção(ões) → ${ink.rope("mohs sign croqui")}`,
      ink.warn,
    ),
  "croqui.saved": ({ data }) => row("croqui", `assinado e salvo em ${data.file}: os próximos climbs o levam no pack`, ink.ok),
  "climb.resumed": ({ data }) =>
    row("resumed", `o Basecamp anterior parou no evento ${data.after}; seguindo do que ficou pronto`, ink.warn),
  "climb.escalated": ({ data }) => row("escalated", `a correção pediu o fluxo completo: ${data.reason}`, ink.warn),
  "ascent.planned": ({ data }) => row("ascent", `${describeWindows(data.windows)} · cada route sobe assim que pode`),
  "route.waiting": ({ route, data }) => row("waiting", `route ${route} pronta · espera ${data.for.join(", ")} entrar na entrega`),
  "window.opened": ({ data }) => row("window", `${data.n} · routes ${data.routes.join(", ")} em paralelo`),
  "pitch.started": ({ route, pitch, data }) => {
    const skills = data.pack.skills.length ? ` · ${data.pack.skills.join(", ")}` : "";
    return row(
      "pitch",
      `${ink.bold(`${route}${pitch}`)} ${data.title}${data.crux ? ink.rope(" · crux") : ""} · ${ink.dim(`${data.model} · pack ${formatO2(data.pack.tokens)}${skills}`)}`,
    );
  },
  "pitch.anchor": ({ route, pitch, data }) => {
    const checks = data.checks.length ? `${data.checks.join(" · ")} passou · ` : "";
    const files = data.files?.length ? ` (${data.files.join(", ")})` : "";
    const commit = data.commit ? `commit ${data.commit}${files}` : "nada a commitar";
    return row("anchor", `${route}${pitch} · ${checks}${commit}${data.fix ? ` · depois do fix (${data.fix})` : ""}`, ink.ok);
  },
  "send.started": ({ route, data }) =>
    row("send", `route ${route} · tentativa ${data.attempt}${data.fullSuite ? " · com a suíte completa" : ""}`),
  "send.clean": ({ route, data }) => row("sent", `route ${route} · ${data.total} testes selados passaram`, ink.ok),
  "send.fall": ({ route, data }) => row("fall", `route ${route} · ${data.failed} de ${data.total} falharam`, ink.crit),
  "fix.started": ({ route, data }) => row("fix", `route ${route} · ${data.reason === "fall" ? "depois da fall" : "achados da inspection"}`),
  "inspection.started": ({ route, data }) => row("inspect", `route ${route} · ${data.inspectors.join(", ")}`),
  "inspection.report": ({ route, data }) =>
    data.findings.map((f) =>
      row(
        "report",
        `route ${route} · ${f.inspector} · ${severityLabel(f.severity)} ${ink.dim(f.action)} · ${f.text}`,
        f.action === "block" ? ink.crit : undefined,
      ),
    ),
  "inspection.blocked": ({ route, data }) => row("blocked", `route ${route} · ${data.count} achado(s) bloqueante(s)`, ink.crit),
  "route.summit": ({ route, data }, view) => {
    const summited = view.routes.find((r) => r.id === route);
    const line = row("summit", `route ${route} · ${summited?.name ?? ""} · O₂ ${formatO2(summited?.o2 ?? 0)}`, ink.ok);
    const evidence = data.evidence ? [row("", describeEvidence(data.evidence), EVIDENCE_TONE[data.evidence.grade])] : [];
    if (!data.branch) return [line, ...evidence];
    return [
      line,
      ...evidence,
      row("", `${data.commits ?? 0} commit(s) em ${ink.bold(data.branch)} → ${ink.rope(`git merge ${data.branch}`)}`),
    ];
  },
  "integration.merged": ({ route, data }) =>
    row("merge", `route ${route} entrou na entrega${data.commit ? ` · ${data.commit}` : ""}`, ink.ok),
  "integration.conflict": ({ route, data }) => row("conflict", `route ${route} conflita com a entrega: ${data.files.join(", ")}`, ink.warn),
  "integration.clean": ({ data }) => row("entrega", `${data.total} checagens passaram na entrega`, ink.ok),
  "integration.fall": ({ data }) => row("entrega", `${data.failed} de ${data.total} checagens falharam`, ink.crit),
  "integration.done": ({ data }) =>
    data.branch
      ? row("entrega", `${data.routes.join(" + ")} em ${ink.bold(data.branch)} → ${ink.rope(`git merge ${data.branch}`)}`, ink.ok)
      : null,
  "route.abandoned": ({ route, data }) => row("abandon", `route ${route} · ${data.reason}`, ink.crit),
  call: ({ data }) => {
    if (data.call === "CLIMB" || data.call === "SAFE") return null;
    return row(data.call, `${ink.dim(`${data.from} → ${data.to}`)} · ${summarizeCall(data)}`, data.call === "FALL" ? ink.crit : ink.warn);
  },
  friction: ({ route, data }) => row("friction", `${route ? `route ${route} · ` : ""}${data.kind} · ${data.detail}`, ink.warn),
  "rescue.called": ({ data }) =>
    row("rescue", `${data.reason} → ${ink.rope(`mohs rescue <${data.options.join("|")}>`)} ou no Lookout`, ink.warn),
  "rescue.resolved": ({ data }) => row("rescue", `você escolheu ${data.option}`, ink.ok),
  "descent.beta": ({ data }) => [
    row("descent", `${data.proposals.length} proposta(s) do scribe`),
    ...data.proposals.map((p) => row("", `${ink.bold(p.id)} ${p.kind} · ${p.summary}`)),
  ],
  "climb.done": (_event, view) => {
    const summited = view.routes.filter((route) => route.state === "summited").length;
    return row(
      "done",
      `O₂ ${formatO2(view.o2.used)} de ${formatO2(view.o2.budget)} · ${summited}/${view.routes.length} routes no summit · ${view.falls} fall(s) · ${view.friction.length} friction`,
      ink.ok,
    );
  },
  "climb.aborted": ({ data }) => row("aborted", data.reason, ink.crit),
};

export function describeEvent(event: MohsEvent, view: ClimbView): string | null {
  const write = WRITERS[event.type] as LineWriter<EventType> | undefined;
  const lines = write?.(event, view);
  if (!lines || (Array.isArray(lines) && !lines.length)) return null;
  return Array.isArray(lines) ? lines.join("\n") : lines;
}

function severityLabel(severity: Severity): string {
  const label = severity.toUpperCase();
  if (severity === "critical" || severity === "high") return ink.crit(label);
  return severity === "medium" ? ink.warn(label) : ink.dim(label);
}
