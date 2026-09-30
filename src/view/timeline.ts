import { summarizeCall, type CallName } from "../domain/calls.ts";
import type { EventType, MohsEvent } from "../domain/events.ts";
import { describeWait, describeWindows } from "../domain/plan.ts";
import { findRoute } from "./reduction.ts";
import type { ClimbView, TimelineEntry, Tone } from "./types.ts";

type Draft = Pick<TimelineEntry, "tag" | "tone" | "text" | "who">;
type Describer<K extends EventType> = (event: MohsEvent<K>, view: ClimbView) => Draft | null;
type DescriberMap = { [K in EventType]?: Describer<K> };

const MAX_ENTRIES = 120;

const CALL_TONE: Record<CallName, Tone> = { CLIMB: "plain", SAFE: "ok", FALL: "crit", WATCH: "warn", ROCK: "warn", TAKE: "warn" };

/** How each event reads in the Lookout feed. Events not listed stay out of the timeline. */
const DESCRIBERS: DescriberMap = {
  "scout.hardness": ({ data }) => ({
    tag: "scout",
    tone: "muted",
    who: "scout",
    text: `${data.kind === "variation" ? "variation" : "first ascent"} · ${data.routes.length} routes · ${data.reason}`,
  }),
  "survey.ready": ({ data }) => ({
    tag: "survey",
    tone: "muted",
    who: "basecamp",
    text: `${data.files} arquivos mapeados · ${data.kind === "variation" ? "variation" : "first ascent"}`,
  }),
  "line.drafted": ({ actor }) => ({ tag: "line", tone: "warn", who: actor, text: "line pronta, aguardando sua assinatura" }),
  "repro.red": ({ data }) => ({ tag: "repro", tone: "plain", who: "reproducer", text: `bug reproduzido: ${data.shows}` }),
  "repro.adopted": ({ route }) => ({
    tag: "repro",
    tone: "ok",
    who: "basecamp",
    text: `route ${route}: teste de reprodução entra no projeto`,
  }),
  "line.decided": ({ data }) => ({
    tag: "decided",
    tone: "plain",
    who: "humano",
    text: data.decisions
      .map((decision) => `${decision.id}: ${decision.answer}${decision.by === "recommended" ? "" : " (escolha do humano)"}`)
      .join(" · "),
  }),
  "line.signed": ({ data }) => ({ tag: "signed", tone: "ok", who: data.by, text: `line assinada (${data.hash.slice(0, 7)})` }),
  "beta.accepted": ({ data }) => ({
    tag: "beta",
    tone: "ok",
    who: "human",
    text: `${data.id} aceita${data.file ? ` → ${data.file}` : " (aplicar à mão)"}`,
  }),
  "beta.rejected": ({ data }) => ({ tag: "beta", tone: "muted", who: "human", text: `${data.id} recusada` }),
  "integration.merged": ({ route, data }) => ({
    tag: "merge",
    tone: "ok",
    who: "basecamp",
    text: `route ${route} entrou na entrega${data.commit ? ` (${data.commit})` : ""}`,
  }),
  "integration.conflict": ({ route, data }) => ({
    tag: "conflict",
    tone: "warn",
    who: "basecamp",
    text: `route ${route} conflita com a entrega: ${data.files.join(", ")}`,
  }),
  "integration.started": ({ data }) => ({
    tag: "integra",
    tone: "plain",
    who: "basecamp",
    text: `checando a entrega (tentativa ${data.attempt})`,
  }),
  "integration.clean": ({ data }) => ({ tag: "integra", tone: "ok", who: "basecamp", text: `entrega limpa: ${data.total} checagens` }),
  "integration.fall": ({ data }) => ({
    tag: "fall",
    tone: "crit",
    who: "basecamp",
    text: `entrega: ${data.failed} de ${data.total} checagens falharam`,
  }),
  "integration.fixed": ({ data }) => ({
    tag: "integra",
    tone: "ok",
    who: "climber",
    text: `entrega corrigida${data.commit ? ` (${data.commit})` : ""}`,
  }),
  "integration.done": ({ data }) => ({
    tag: "entrega",
    tone: "ok",
    who: "basecamp",
    text: `${data.routes.join(" + ")} juntas em ${data.branch ?? "(simulado)"}`,
  }),
  "signature.requested": ({ data, actor }) => ({ tag: "sign", tone: "warn", who: actor, text: `${data.what}: aguardando sua assinatura` }),
  "signature.given": ({ data }) => ({
    tag: "signed",
    tone: "ok",
    who: data.by,
    text: `${data.target} assinado (${data.hash.slice(0, 7)})`,
  }),
  "seal.red": ({ data }) => ({
    tag: "seal",
    tone: "muted",
    who: "basecamp",
    text: `${data.total} testes selados, todos vermelhos no código atual`,
  }),
  "seal.disputed": ({ route, data }) => ({
    tag: "dispute",
    tone: "warn",
    who: `climber ${route}`,
    text: `contesta a FALL com a line: ${data.argument}`,
  }),
  "seal.upheld": ({ actor, data }) => ({ tag: "upheld", tone: "muted", who: actor, text: `teste mantido: ${data.reason}` }),
  "seal.amended": ({ route, data }) => ({ tag: "amended", tone: "warn", who: `belayer ${route}`, text: `teste corrigido: ${data.reason}` }),
  "decisions.taken": ({ route, data }) => ({
    tag: "decisions",
    tone: "warn",
    who: `climber ${route}`,
    text: `decidiu sozinho: ${data.decisions.join("; ")}`,
  }),
  "croqui.drafted": ({ data }) => ({
    tag: "croqui",
    tone: "warn",
    who: "scout",
    text: `croqui pronto para assinar: ${data.entities} entidade(s), ${data.sections} seção(ões) livre(s)`,
  }),
  "croqui.saved": ({ data }) => ({ tag: "croqui", tone: "ok", who: "basecamp", text: `croqui salvo em ${data.file}` }),
  "climb.resumed": ({ data }) => ({ tag: "resumed", tone: "warn", who: "human", text: `climb retomado depois do evento ${data.after}` }),
  "climb.escalated": ({ data }) => ({
    tag: "escalated",
    tone: "warn",
    who: "basecamp",
    text: `a correção pediu o fluxo completo: ${data.reason}`,
  }),
  "ascent.planned": ({ data }) => ({
    tag: "ascent",
    tone: "muted",
    who: "basecamp",
    text: `ordem: ${describeWindows(data.windows)}; cada route sobe assim que pode`,
  }),
  "route.waiting": ({ route, data }) => ({
    tag: "waiting",
    tone: "muted",
    who: "basecamp",
    text: `route ${route} pronta, ${describeWait(data.for)}`,
  }),
  "window.opened": ({ data }) => ({
    tag: "window",
    tone: "muted",
    who: "basecamp",
    text: `window ${data.n} · routes ${data.routes.join(", ")}`,
  }),
  "send.clean": ({ data }) => ({
    tag: "sent",
    tone: "ok",
    who: "basecamp",
    text: `${data.total} de ${data.total} testes selados passaram`,
  }),
  "inspection.started": ({ data }) => ({
    tag: "inspection",
    tone: "muted",
    who: "basecamp",
    text: `${data.inspectors.join(", ")} em paralelo`,
  }),
  "inspection.report": ({ data }) => {
    if (!data.findings.length) return null;
    const blocking = data.findings.filter((finding) => finding.action === "block").length;
    return {
      tag: "report",
      tone: blocking ? "crit" : "muted",
      who: `inspector ${data.inspector}`,
      text: `${data.inspector}: ${data.findings.length} achado(s)${blocking ? `, ${blocking} bloqueia` : ""}`,
    };
  },
  "inspection.blocked": ({ data }) => ({
    tag: "blocked",
    tone: "crit",
    who: "brake",
    text: `o brake bloqueou a route (${data.count} achado)`,
  }),
  "route.summit": ({ route, data }, view) => ({
    tag: "summit",
    tone: "ok",
    who: "basecamp",
    text: `${routeName(view, route)} entregue${data.branch ? ` na branch ${data.branch}` : ""}${data.evidence ? ` · evidência ${data.evidence.grade}` : ""}`,
  }),
  "route.abandoned": ({ route }, view) => ({ tag: "abandoned", tone: "crit", who: "human", text: `${routeName(view, route)} abandonada` }),
  call: ({ data }) => ({ tag: data.call, tone: CALL_TONE[data.call], who: `${data.from} → ${data.to}`, text: summarizeCall(data) }),
  friction: ({ data }) => ({ tag: "friction", tone: "warn", who: data.kind, text: data.detail }),
  "descent.beta": ({ data }) => ({
    tag: "descent",
    tone: "muted",
    who: "scribe",
    text: `${data.proposals.length} proposta(s) com evidência, aguardando sua escolha`,
  }),
  "climb.done": () => ({ tag: "done", tone: "ok", who: "basecamp", text: "climb concluído" }),
  "climb.aborted": ({ data, actor }) => ({ tag: "aborted", tone: "crit", who: actor, text: data.reason }),
};

export function appendToTimeline(view: ClimbView, event: MohsEvent): void {
  const describe = DESCRIBERS[event.type] as Describer<EventType> | undefined;
  const draft = describe?.(event, view);
  if (!draft) return;
  view.timeline.push({ seq: event.seq, ts: event.ts, route: event.route, ...draft });
  if (view.timeline.length > MAX_ENTRIES) view.timeline.shift();
}

function routeName(view: ClimbView, id: string | undefined): string {
  return (id && findRoute(view, id)?.name) || `route ${id ?? "?"}`;
}
