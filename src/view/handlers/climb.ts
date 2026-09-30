import { MOHS_SCALE } from "../../domain/types.ts";
import type { HandlerMap } from "../reduction.ts";
import type { RouteView } from "../types.ts";

/** Climb-level lifecycle: scout, survey, line, the ascent plan, rescue, descent and the end. */
export const climbHandlers: HandlerMap = {
  "climb.started": ({ view, event, data }) => {
    view.request = data.request;
    view.project = data.project;
    view.scenario = data.scenario;
    view.autoSign = data.autoSign;
    view.startedAt = event.ts;
    view.state = "surveying";
  },

  "scout.started": (r) => r.moveClimb("scouting"),
  "croqui.started": (r) => r.moveClimb("scouting"),
  "croqui.saved": ({ view, data }) => {
    view.croqui = data.file;
  },

  "scout.hardness": ({ view, data }) => {
    view.kind = data.kind;
    view.hardness = data.hardness;
    view.reason = data.reason;
    view.o2.budget = data.budget;
    view.routes = data.routes.map((route): RouteView => ({
      id: route.id,
      name: route.name,
      hardness: route.hardness,
      mohs: MOHS_SCALE[route.hardness],
      files: route.files,
      tags: route.tags,
      state: "planned",
      label: "planned",
      pos: 0,
      pitches: route.pitches.map((pitch, i) => ({ n: i + 1, title: pitch.title, crux: !!pitch.crux, files: pitch.files, state: "ready" })),
      falls: 0,
      o2: 0,
      budget: route.budget,
      bolts: false,
      inspectors: [],
      findings: [],
      friction: [],
    }));
  },

  "scout.escalated": (r) => {
    const route = r.route();
    if (!route) return;
    route.hardness = r.data.to;
    route.mohs = MOHS_SCALE[r.data.to];
  },

  "survey.started": (r) => r.moveClimb("surveying"),
  "survey.ready": ({ view, data }) => {
    view.kind = data.kind;
    view.survey = { files: data.files, summary: data.summary };
  },

  "line.started": (r) => r.moveClimb("lining"),
  "line.drafted": (r) => {
    // Um novo rascunho durante a espera pela assinatura volta para lining antes de aguardar de novo.
    if (r.view.state === "awaiting_signature") r.moveClimb("lining");
    r.moveClimb("awaiting_signature");
    r.view.line = { hash: r.data.hash, text: r.data.text, signed: false, drafts: (r.view.line?.drafts ?? 0) + 1 };
  },
  "line.signed": ({ view, data }) => {
    if (!view.line) return;
    view.line.signed = true;
    view.line.signedBy = data.by;
  },

  "signature.requested": ({ view, event, data }) => {
    view.signatures = view.signatures.filter((signature) => signature.target !== data.target);
    view.signatures.push({ ...data, route: event.route, signed: false });
    const route = event.route ? view.routes.find((r) => r.id === event.route) : undefined;
    if (route) route.label = "assinatura";
  },
  "signature.given": ({ view, data }) => {
    const signature = view.signatures.find((s) => s.target === data.target);
    if (signature) Object.assign(signature, { signed: true, by: data.by, hash: data.hash });
  },

  "integration.merged": ({ view, event }) => {
    view.delivery ??= { merged: [], conflicts: 0, falls: 0, clean: false };
    if (event.route) view.delivery.merged.push(event.route);
  },
  "integration.conflict": ({ view }) => {
    view.delivery ??= { merged: [], conflicts: 0, falls: 0, clean: false };
    view.delivery.conflicts++;
  },
  "integration.started": (r) => r.moveClimb("integrating"),
  "integration.fall": ({ view }) => {
    if (view.delivery) view.delivery.falls++;
  },
  "integration.clean": ({ view }) => {
    if (view.delivery) view.delivery.clean = true;
  },
  "integration.done": ({ view, data }) => {
    view.delivery ??= { merged: [], conflicts: 0, falls: 0, clean: false };
    Object.assign(view.delivery, { branch: data.branch, commits: data.commits });
  },

  "ascent.planned": (r) => {
    r.moveClimb("climbing");
    r.view.windows = r.data.windows;
    for (const route of r.view.routes) {
      const index = r.data.windows.findIndex((ids) => ids.includes(route.id));
      if (index >= 0) route.window = index + 1;
    }
  },

  "window.opened": (r) => {
    if (r.view.state !== "climbing") r.moveClimb("climbing");
    r.view.windows.push(r.data.routes);
    for (const route of r.view.routes) if (r.data.routes.includes(route.id)) route.window = r.view.windows.length;
  },

  "rescue.called": (r) => {
    if (r.view.state !== "rescue") r.view.resumeTo = r.view.state;
    r.moveClimb("rescue");
    r.view.rescue = { seq: r.event.seq, reason: r.data.reason, options: r.data.options, route: r.event.route };
  },
  "rescue.resolved": (r) => {
    r.moveClimb(r.view.resumeTo ?? "climbing");
    r.view.resumeTo = undefined;
    r.view.rescue = undefined;
  },

  "descent.started": (r) => r.moveClimb("descending"),
  "descent.beta": ({ view, data }) => {
    view.proposals = data.proposals.map((proposal) => ({ ...proposal, status: "pending" }));
  },
  "beta.accepted": ({ view, data }) => {
    const proposal = view.proposals.find((p) => p.id === data.id);
    if (proposal) Object.assign(proposal, { status: "accepted", file: data.file });
  },
  "beta.rejected": ({ view, data }) => {
    const proposal = view.proposals.find((p) => p.id === data.id);
    if (proposal) proposal.status = "rejected";
  },

  "climb.done": (r) => {
    r.moveClimb("done");
    r.view.endedAt = r.event.ts;
  },
  "climb.aborted": (r) => {
    r.moveClimb("aborted");
    r.view.endedAt = r.event.ts;
  },
  // O Basecamp anterior parou no meio: o que estava em andamento volta ao começo e o novo refaz a partir do que ficou pronto.
  "climb.resumed": ({ view }) => {
    if (view.state === "rescue") view.state = view.resumeTo ?? "climbing";
    view.resumeTo = undefined;
    view.rescue = undefined;
    for (const route of view.routes) {
      if (["planned", "summited", "abandoned"].includes(route.state)) continue;
      route.state = "planned";
      route.label = "retomando";
    }
  },
  "climb.escalated": (r) => {
    r.moveClimb("escalated");
    r.view.escalation = r.data.reason;
    r.view.endedAt = r.event.ts;
  },
};
