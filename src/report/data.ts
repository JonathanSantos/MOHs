import { join } from "node:path";
import { EVENTS_FILE, readEvents } from "../basecamp/event-log.ts";
import type { EventType, MohsEvent } from "../domain/events.ts";
import { countScenarios } from "../domain/line.ts";
import { describeWait, describeWindows } from "../domain/plan.ts";
import { listTasks } from "../tasks/file-board.ts";
import { project } from "../view/reducer.ts";

/**
 * Everything the visual report shows about one climb, taken from its event log and task records. Only metadata:
 * no pack, no brief, no sealed test ever lands here, because belayer tasks carry the sealed code.
 */
export interface ReportData {
  climb: {
    id: string;
    request: string;
    project: string;
    state: string;
    hardness?: string;
    kind?: string;
    startedAt: string;
    endedAt?: string;
    o2: number;
    budget: number;
  };
  survey?: string;
  plan: { reason?: string; routes: ReportRoute[]; windows: string[][] };
  line?: { signedBy?: string; draftedAt?: string; signedAt?: string; drafts: number; decisions: string[]; scenarios: number };
  tasks: ReportTask[];
  phases: { name: string; start: string; end?: string }[];
  decisions: Decision[];
  friction: { kind: string; count: number; samples: string[] }[];
  delivery?: {
    merged: string[];
    conflicts: number;
    checks: { attempt: number; ok: boolean; failed: number; total: number }[];
    branch?: string;
    commits?: number;
  };
  proposals: { id: string; kind: string; target: string; summary: string; status: string }[];
  o2ByRole: Record<string, number>;
}

export interface ReportRoute {
  id: string;
  name: string;
  hardness: string;
  files: string[];
  after: string[];
  pitches: { title: string; crux: boolean; anchors: number; retries: number }[];
  window?: number;
  state: string;
  branch?: string;
  commits?: number;
  falls: number;
  seal?: { unit: number; e2e: number };
  findings: { severity: string; action: string; inspector: string; text: string }[];
  evidence?: { grade: string; proofs: string[] };
}

export interface ReportTask {
  id: string;
  role: string;
  route?: string;
  title: string;
  agent: string;
  openedAt: string;
  closedAt?: string;
  answered?: string;
}

export interface Decision {
  ts: string;
  who: string;
  role: string;
  title: string;
  detail?: string;
  tone: "plain" | "ok" | "warn" | "crit" | "human";
}

type Describe<K extends EventType> = (event: MohsEvent<K>) => Omit<Decision, "ts"> | null;

/** Which events are decisions, and how each reads. Everything else stays in the log. */
const DECISIONS: { [K in EventType]?: Describe<K> } = {
  "scout.hardness": ({ data }) => ({
    who: "scout",
    role: "scout",
    title: `Plano: ${data.routes.length} route(s), hardness ${data.hardness}`,
    detail: data.reason,
    tone: "plain",
  }),
  "scout.escalated": ({ route, data }) => ({
    who: "humano",
    role: "human",
    title: `Route ${route}: ${data.from} → ${data.to}`,
    detail: data.reason,
    tone: "human",
  }),
  "line.decided": ({ data }) => ({
    who: "humano",
    role: "human",
    title: `Decisões da line: ${data.decisions.filter((decision) => decision.by !== "recommended").length} de ${data.decisions.length} fora da recomendada`,
    detail: data.decisions.map((decision) => `${decision.id} → ${decision.answer}`).join(" · "),
    tone: "human",
  }),
  "line.signed": ({ data }) => ({
    who: data.by,
    role: "human",
    title: "Line assinada",
    detail: `hash ${data.hash.slice(0, 12)}`,
    tone: "human",
  }),
  "signature.given": ({ data }) => ({
    who: data.by,
    role: "human",
    title: `${data.target} assinado`,
    detail: `hash ${data.hash.slice(0, 12)}`,
    tone: "human",
  }),
  "seal.written": ({ route, data }) => ({
    who: `belayer ${route}`,
    role: "belayer",
    title: `Seal da route ${route}: ${data.unit} unit, ${data.e2e} e2e`,
    detail: data.attempt > 1 ? `tentativa ${data.attempt}` : undefined,
    tone: "plain",
  }),
  "seal.red": ({ route, data }) => ({
    who: "basecamp",
    role: "basecamp",
    title: `Seal da route ${route} conferido: ${data.total} vermelho(s) no código atual`,
    tone: "ok",
  }),
  "seal.disputed": ({ route, data }) => ({
    who: `climber ${route}`,
    role: "climber",
    title: `Contestou a FALL da route ${route} com a line`,
    detail: `"${data.excerpt}" · ${data.argument}`,
    tone: "warn",
  }),
  "seal.upheld": ({ route, actor, data }) => ({
    who: actor,
    role: actor === "human" ? "human" : "belayer",
    title: `Teste da route ${route} mantido`,
    detail: data.reason,
    tone: actor === "human" ? "human" : "plain",
  }),
  "seal.amended": ({ route, data }) => ({
    who: `belayer ${route}`,
    role: "belayer",
    title: `Teste da route ${route} corrigido depois da contestação`,
    detail: data.reason,
    tone: "warn",
  }),
  "decisions.taken": ({ route, data }) => ({
    who: `climber ${route}`,
    role: "climber",
    title: `O climber decidiu sozinho (${data.decisions.length})`,
    detail: data.decisions.join(" · "),
    tone: "warn",
  }),
  "climb.resumed": ({ data }) => ({
    who: "humano",
    role: "human",
    title: "Climb retomado depois que o Basecamp parou",
    detail: `seguiu do evento ${data.after}, sem refazer o que estava pronto`,
    tone: "warn",
  }),
  "climb.escalated": ({ actor, data }) => ({
    who: actor,
    role: actor === "climber" ? "climber" : "basecamp",
    title: "A correção pediu o fluxo completo",
    detail: data.reason,
    tone: "warn",
  }),
  "ascent.planned": ({ data }) => ({
    who: "basecamp",
    role: "basecamp",
    title: `Ordem da subida: ${describeWindows(data.windows)}`,
    detail: "cada route sobe assim que o rigging dela e as routes de que ela parte estão prontos",
    tone: "plain",
  }),
  "route.waiting": ({ route, data }) => ({
    who: "basecamp",
    role: "basecamp",
    title: `Route ${route} pronta, ${describeWait(data.for)}`,
    tone: "plain",
  }),
  "window.opened": ({ data }) => ({
    who: "basecamp",
    role: "basecamp",
    title: `Janela ${data.n}: ${data.routes.join(" e ")}${data.routes.length > 1 ? " em paralelo" : ""}`,
    tone: "plain",
  }),
  "pitch.retry": ({ route, pitch, data }) => ({
    who: "basecamp",
    role: "basecamp",
    title: `Pitch ${route}${pitch} volta ao climber (tentativa ${data.attempt})`,
    tone: "warn",
  }),
  "send.fall": ({ route, data }) => ({
    who: "basecamp",
    role: "basecamp",
    title: `Fall na route ${route}: ${data.failed} de ${data.total} selados falharam`,
    tone: "crit",
  }),
  "send.clean": ({ route, data }) => ({
    who: "basecamp",
    role: "basecamp",
    title: `Send limpo na route ${route}: ${data.total} selados passaram`,
    tone: "ok",
  }),
  "inspection.blocked": ({ route, data }) => ({
    who: "brake",
    role: "basecamp",
    title: `Brake bloqueou a route ${route}: ${data.count} achado(s)`,
    tone: "crit",
  }),
  "rescue.called": ({ route, data }) => ({
    who: "basecamp",
    role: "basecamp",
    title: `Rescue${route ? ` na route ${route}` : ""}: chamou o humano`,
    detail: data.reason,
    tone: "warn",
  }),
  "rescue.resolved": ({ data }) => ({ who: "humano", role: "human", title: `Humano escolheu ${data.option}`, tone: "human" }),
  "route.summit": ({ route, data }) => ({
    who: "basecamp",
    role: "basecamp",
    title: `Route ${route} no summit${data.evidence ? `, evidência ${data.evidence.grade}` : ""}`,
    detail: [data.branch, data.evidence?.proofs.join(" · ")].filter(Boolean).join(" · ") || undefined,
    tone: data.evidence && ["fraca", "nenhuma"].includes(data.evidence.grade) ? "warn" : "ok",
  }),
  "route.abandoned": ({ route, data }) => ({
    who: "humano",
    role: "human",
    title: `Route ${route} abandonada`,
    detail: data.reason,
    tone: "crit",
  }),
  "integration.merged": ({ route, data }) => ({
    who: "basecamp",
    role: "basecamp",
    title: `Route ${route} entrou na entrega`,
    detail: data.commit,
    tone: "ok",
  }),
  "integration.conflict": ({ route, data }) => ({
    who: "basecamp",
    role: "basecamp",
    title: `Conflito ao juntar a route ${route}`,
    detail: data.files.join(", "),
    tone: "warn",
  }),
  "integration.fall": ({ data }) => ({
    who: "basecamp",
    role: "basecamp",
    title: `Entrega falhou: ${data.failed} de ${data.total} checagens`,
    tone: "crit",
  }),
  "integration.clean": ({ data }) => ({
    who: "basecamp",
    role: "basecamp",
    title: `Entrega limpa: ${data.total} checagens juntas`,
    tone: "ok",
  }),
  "descent.beta": ({ data }) => ({
    who: "scribe",
    role: "scribe",
    title: `Scribe propôs ${data.proposals.length} melhoria(s)`,
    tone: "plain",
  }),
  "beta.accepted": ({ data }) => ({ who: "humano", role: "human", title: `Proposta ${data.id} aceita`, detail: data.file, tone: "human" }),
  "beta.rejected": ({ data }) => ({ who: "humano", role: "human", title: `Proposta ${data.id} recusada`, tone: "human" }),
  "climb.aborted": ({ data }) => ({ who: "basecamp", role: "basecamp", title: "Climb interrompido", detail: data.reason, tone: "crit" }),
  call: ({ data, route }) => {
    if (data.call === "WATCH")
      return { who: data.from, role: "climber", title: `WATCH: ${data.question}`, detail: data.excerpt, tone: "warn" };
    if (data.call === "ROCK") return { who: data.from, role: "climber", title: `ROCK: ${data.command}`, detail: data.error, tone: "warn" };
    if (data.call === "FALL")
      return {
        who: data.from,
        role: "belayer",
        title: `FALL para o climber${route ? ` (route ${route})` : ""}`,
        detail: `${data.scenario}: esperado ${data.expected}, obtido ${data.actual}`,
        tone: "crit",
      };
    return null;
  },
  friction: ({ route, data }) =>
    data.kind === "crew.note"
      ? {
          who: `climber${route ? ` ${route}` : ""}`,
          role: "climber",
          title: "Nota do climber (fora do escopo)",
          detail: data.detail,
          tone: "plain",
        }
      : null,
};

/**
 * Stages as the Basecamp moved through them: from the climb-level event that opens each to the one that closes it.
 * Since 5.2 bolts and seal belong to each route and show in the agents' lanes; "Bolts e seal" only exists in older logs.
 */
const PHASES: { name: string; start: EventType[]; end: EventType[] }[] = [
  { name: "Survey", start: ["survey.started"], end: ["survey.ready"] },
  { name: "Scout", start: ["scout.started"], end: ["scout.hardness"] },
  { name: "Line", start: ["line.started"], end: ["line.drafted"] },
  { name: "Assinatura", start: ["line.drafted"], end: ["line.signed"] },
  { name: "Bolts e seal", start: ["bolts.started"], end: ["window.opened"] },
  {
    name: "Routes",
    start: ["ascent.planned", "window.opened"],
    end: ["integration.started", "descent.started", "climb.done", "climb.aborted"],
  },
  { name: "Entrega", start: ["integration.started"], end: ["integration.done"] },
  { name: "Descent", start: ["descent.started"], end: ["descent.beta"] },
];

export function buildReport(climbDir: string): ReportData {
  const events = readEvents(join(climbDir, EVENTS_FILE));
  const view = project(events);
  const first = (type: EventType) => events.find((event) => event.type === type);
  const last = (type: EventType) => events.findLast((event) => event.type === type);
  const plan = first("scout.hardness");
  const planned = plan?.type === "scout.hardness" ? plan.data : undefined;

  const routes: ReportRoute[] = (planned?.routes ?? []).map((route) => {
    const own = (type: EventType) => events.filter((event) => event.type === type && event.route === route.id);
    const routeView = view.routes.find((r) => r.id === route.id);
    const seal = own("seal.written").at(-1);
    return {
      id: route.id,
      name: route.name,
      hardness: routeView?.hardness ?? route.hardness,
      files: route.files,
      after: route.after ?? [],
      pitches: route.pitches.map((pitch, index) => ({
        title: pitch.title,
        crux: Boolean(pitch.crux),
        anchors: own("pitch.anchor").filter((event) => event.pitch === index + 1).length,
        retries: own("pitch.retry").filter((event) => event.pitch === index + 1).length,
      })),
      window: routeView?.window,
      state: routeView?.state ?? "planned",
      branch: routeView?.branch,
      commits: routeView?.commits,
      falls: own("send.fall").length,
      seal: seal?.type === "seal.written" ? { unit: seal.data.unit, e2e: seal.data.e2e } : undefined,
      findings: (routeView?.findings ?? []).map(({ severity, action, inspector, text }) => ({ severity, action, inspector, text })),
      evidence: routeView?.evidence,
    };
  });

  const lineText = view.line?.text ?? "";
  const drafted = last("line.drafted");
  const signed = last("line.signed");
  const tasks: ReportTask[] = listTasks(climbDir).map((task) => ({
    id: task.id,
    role: task.role,
    route: task.route,
    title: task.title,
    agent: task.claimedBy ?? `${task.role}${task.route ? ` ${task.route}` : ""}`,
    openedAt: task.openedAt,
    closedAt: task.closedAt,
    answered: task.answered,
  }));

  const decisions: Decision[] = events.flatMap((event) => {
    const describe = DECISIONS[event.type] as Describe<EventType> | undefined;
    const decision = describe?.(event);
    return decision ? [{ ts: event.ts, ...decision }] : [];
  });

  const friction = [...Map.groupBy(view.friction, (f) => f.kind)].map(([kind, list]) => ({
    kind,
    count: list.length,
    samples: list.slice(0, 3).map((f) => f.detail.slice(0, 240)),
  }));

  const o2ByRole: Record<string, number> = {};
  for (const event of events) if (event.o2) o2ByRole[roleOf(event.actor)] = (o2ByRole[roleOf(event.actor)] ?? 0) + event.o2;

  const checks = events.flatMap((event) => {
    if (event.type === "integration.clean") return [{ attempt: event.data.attempt, ok: true, failed: 0, total: event.data.total }];
    if (event.type === "integration.fall")
      return [{ attempt: event.data.attempt, ok: false, failed: event.data.failed, total: event.data.total }];
    return [];
  });

  return {
    climb: {
      id: view.id,
      request: view.request,
      project: view.project,
      state: view.state,
      hardness: view.hardness,
      kind: view.kind,
      startedAt: view.startedAt,
      endedAt: view.endedAt ?? events.at(-1)?.ts,
      o2: view.o2.used,
      budget: view.o2.budget,
    },
    survey: view.survey?.summary,
    plan: { reason: planned?.reason, routes, windows: view.windows },
    line: view.line
      ? {
          signedBy: view.line.signedBy,
          draftedAt: drafted?.ts,
          signedAt: signed?.ts,
          drafts: view.line.drafts,
          decisions: view.line.settled
            ? view.line.settled.map(
                (decision) => `${decision.question} → ${decision.answer}${decision.by === "recommended" ? "" : " (escolha do humano)"}`,
              )
            : decisionsIn(lineText),
          scenarios: countScenarios(lineText),
        }
      : undefined,
    tasks,
    phases: PHASES.flatMap(({ name, start, end }) => {
      const opened = events.find((event) => start.includes(event.type) && !event.route);
      if (!opened) return [];
      const closed = events.find((event) => event.seq > opened.seq && end.includes(event.type));
      return [{ name, start: opened.ts, end: closed?.ts }];
    }),
    decisions,
    friction,
    delivery: view.delivery
      ? {
          merged: view.delivery.merged,
          conflicts: view.delivery.conflicts,
          checks,
          branch: view.delivery.branch,
          commits: view.delivery.commits,
        }
      : undefined,
    proposals: view.proposals.map(({ id, kind, target, summary, status }) => ({ id, kind, target, summary, status })),
    o2ByRole,
  };
}

/** The items of the line's "Decisões a confirmar" section: the choices a human signed off on. */
function decisionsIn(line: string): string[] {
  const section = /^##+ [^\n]*[Dd]ecis[^\n]*\n([\s\S]*?)(?=\n##+ |(?![\s\S]))/m.exec(line)?.[1] ?? "";
  const item = /^\s*(?:[-*]|\d+[.)])\s+/;
  return section
    .split("\n")
    .filter((row) => item.test(row))
    .map((row) => row.replace(item, "").trim());
}

function roleOf(actor: string): string {
  return actor.split(" ")[0];
}
