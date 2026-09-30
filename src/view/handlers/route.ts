import { topOf, type HandlerMap } from "../reduction.ts";

/**
 * Route-level progress. Besides the state, each handler keeps `pos` (where the climber is on the
 * wall, in pitches) and `label` (what the Lookout shows under the route).
 */
export const routeHandlers: HandlerMap = {
  // Sem route no evento é log anterior à 5.2: o rigging era uma etapa do climb inteiro.
  "bolts.started": (r) => {
    if (!r.event.route) return r.moveClimb("bolting");
    const route = r.route();
    if (!route) return;
    r.moveRoute(route, "bolting");
    route.label = "bolts";
  },
  "bolts.set": (r) => {
    const route = r.route();
    if (route) route.bolts = true;
  },

  // O seal corre junto da subida: ele só vira o estado de uma route que ainda não começou a subir.
  "seal.started": (r) => {
    if (!r.event.route) return r.moveClimb("sealing");
    const route = r.route();
    if (!route || !["planned", "bolting"].includes(route.state)) return;
    r.moveRoute(route, "sealing");
    route.label = "seal";
  },

  "seal.written": (r) => {
    const route = r.route();
    if (route) route.seal = { unit: r.data.unit, e2e: r.data.e2e, red: false };
  },
  "seal.red": (r) => {
    const route = r.route();
    if (!route?.seal) return;
    route.seal.red = true;
    if (route.state === "sealing") route.label = "selada";
  },
  "decisions.taken": (r) => {
    const route = r.route();
    if (route) route.decisions = r.data.decisions;
  },
  "seal.disputed": (r) => {
    const route = r.route();
    if (route) route.label = "contestação";
  },
  "seal.amended": (r) => {
    const route = r.route();
    if (route?.seal) Object.assign(route.seal, { unit: r.data.unit, e2e: r.data.e2e });
  },
  "route.waiting": (r) => {
    const route = r.route();
    if (!route) return;
    route.waitingFor = r.data.for;
    route.label = `espera ${r.data.for.join(", ")}`;
  },

  "route.started": (r) => {
    const route = r.route();
    if (!route) return;
    route.waitingFor = undefined;
    r.moveRoute(route, "pitching");
    route.startedAt = r.event.ts;
    route.branch = r.data.branch;
    route.label = "pitch 1";
  },

  "pitch.started": (r) => {
    const route = r.route();
    const pitch = route && r.pitchOf(route);
    if (!route || !pitch) return;
    r.moveRoute(route, "pitching");
    pitch.state = "climbing";
    route.pos = pitch.n - 0.5;
    route.label = `pitch ${pitch.n}${pitch.crux ? " · crux" : ""}`;
  },
  "pitch.retry": (r) => {
    const route = r.route();
    const pitch = route && r.pitchOf(route);
    if (!route || !pitch) return;
    pitch.state = "climbing";
    route.pos = pitch.n - 0.5;
    route.label = `pitch ${pitch.n}`;
  },
  "pitch.anchor": (r) => {
    const route = r.route();
    const pitch = route && r.pitchOf(route);
    if (!route || !pitch) return;
    pitch.state = "anchored";
    route.pos = pitch.n;
    route.label = `anchor ${pitch.n}`;
  },

  "send.started": (r) => {
    const route = r.route();
    if (!route) return;
    route.waitingFor = undefined;
    r.moveRoute(route, "sending");
    route.pos = topOf(route);
    route.label = "send";
  },
  "send.clean": (r) => {
    const route = r.route();
    if (route) route.label = "sent";
  },
  // A fall devolve o climber à última anchor abaixo do topo.
  "send.fall": (r) => {
    const route = r.route();
    if (!route) return;
    r.moveRoute(route, "fallen");
    route.falls++;
    r.view.falls++;
    route.pos = Math.max(0, topOf(route) - 1);
    route.label = "fall";
  },
  "fix.started": (r) => {
    const route = r.route();
    if (!route) return;
    r.moveRoute(route, "pitching");
    route.pos = Math.max(0.5, topOf(route) - 0.5);
    route.label = "fix";
  },

  "inspection.started": (r) => {
    const route = r.route();
    if (!route) return;
    r.moveRoute(route, "inspecting");
    route.inspectors = r.data.inspectors;
    route.label = "inspection";
  },
  "inspection.report": (r) => {
    const route = r.route();
    if (route) route.findings.push(...r.data.findings.map((finding) => ({ ...finding, route: route.id, fixed: false })));
  },
  "inspection.blocked": (r) => {
    const route = r.route();
    if (!route) return;
    r.moveRoute(route, "blocked");
    route.label = "blocked";
  },
  "findings.resolved": (r) => {
    for (const finding of r.route()?.findings ?? []) if (finding.action === "block") finding.fixed = true;
  },

  "route.summit": (r) => {
    const route = r.route();
    if (!route) return;
    r.moveRoute(route, "summited");
    route.pos = topOf(route);
    route.label = "summit";
    route.summitAt = r.event.ts;
    route.branch = r.data.branch ?? route.branch;
    route.commits = r.data.commits;
    route.evidence = r.data.evidence;
  },
  "route.abandoned": (r) => {
    const route = r.route();
    if (!route) return;
    r.moveRoute(route, "abandoned");
    route.label = "abandoned";
  },
};
