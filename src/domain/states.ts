export const CLIMB_STATES = [
  "surveying",
  "scouting",
  "lining",
  "awaiting_signature",
  // bolting e sealing ficam para os logs anteriores à 5.2, quando o rigging era uma etapa do climb inteiro.
  "bolting",
  "sealing",
  "climbing",
  "integrating",
  "descending",
  "done",
  "rescue",
  "aborted",
  "escalated",
] as const;
export type ClimbState = (typeof CLIMB_STATES)[number];

export const ROUTE_STATES = [
  "planned",
  "bolting",
  "sealing",
  "pitching",
  "sending",
  "fallen",
  "inspecting",
  "blocked",
  "summited",
  "abandoned",
] as const;
export type RouteState = (typeof ROUTE_STATES)[number];

/** `rescue` e `aborted` não aparecem aqui: são alcançáveis de qualquer estado ativo (ver canClimbTransition). */
export const CLIMB_TRANSITIONS: Record<ClimbState, ClimbState[]> = {
  surveying: ["scouting"],
  // Talc não tem line: do plano do Basecamp vai direto para a subida.
  // Um climb de croqui termina no scout: não há line nem routes.
  scouting: ["lining", "climbing", "done"],
  lining: ["awaiting_signature"],
  awaiting_signature: ["lining", "bolting", "sealing", "climbing"],
  bolting: ["sealing", "climbing"],
  sealing: ["climbing"],
  climbing: ["integrating", "descending", "done"],
  integrating: ["descending", "done"],
  descending: ["done"],
  done: [],
  rescue: [],
  aborted: [],
  escalated: [],
};

export const ROUTE_TRANSITIONS: Record<RouteState, RouteState[]> = {
  // planned → sealing: uma route retomada que já tinha os bolts vai direto ao seal.
  planned: ["bolting", "sealing", "pitching", "abandoned"],
  bolting: ["sealing"],
  sealing: ["pitching"],
  pitching: ["sending", "inspecting", "summited", "abandoned"],
  sending: ["fallen", "inspecting", "summited"],
  fallen: ["pitching", "abandoned"],
  inspecting: ["blocked", "summited"],
  blocked: ["pitching", "abandoned"],
  summited: [],
  abandoned: [],
};

const TERMINAL: ClimbState[] = ["done", "aborted", "escalated"];

export function canClimbTransition(from: ClimbState, to: ClimbState, resumeTo?: ClimbState): boolean {
  if (from === to) return true;
  if (to === "aborted" || to === "escalated") return !TERMINAL.includes(from);
  if (to === "rescue") return !TERMINAL.includes(from);
  if (from === "rescue") return to === resumeTo;
  return CLIMB_TRANSITIONS[from].includes(to);
}

export function canRouteTransition(from: RouteState, to: RouteState): boolean {
  return from === to || ROUTE_TRANSITIONS[from].includes(to);
}
