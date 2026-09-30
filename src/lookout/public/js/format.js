import { escapeHtml } from "./dom.js";

export const MOHS_SCALE = { talc: 1, fluorite: 4, quartz: 7, diamond: 10 };

export const CLIMB_STATES = {
  scouting: { label: "scout", tone: "muted" },
  surveying: { label: "survey", tone: "muted" },
  lining: { label: "line", tone: "muted" },
  awaiting_signature: { label: "aguardando sua assinatura", tone: "warn" },
  bolting: { label: "bolts", tone: "muted" },
  sealing: { label: "seal", tone: "muted" },
  climbing: { label: "climbing", tone: "muted" },
  integrating: { label: "entrega", tone: "muted" },
  descending: { label: "descent", tone: "muted" },
  done: { label: "concluído", tone: "ok" },
  rescue: { label: "rescue: precisa de você", tone: "warn" },
  aborted: { label: "abortado", tone: "crit" },
  escalated: { label: "escalado: pede o fluxo completo", tone: "warn" },
};

export const RESCUE_LABELS = {
  retry: "Tentar de novo",
  abandon: "Abandonar a route",
  proceed: "Seguir mesmo assim",
  abort: "Abortar o climb",
};

export const SEVERITY_ORDER = { critical: 0, high: 1, medium: 2, low: 3 };

export function climbState(state) {
  return CLIMB_STATES[state] ?? { label: state, tone: "muted" };
}

export function hardnessChip(hardness) {
  return `<span class="chip h-${escapeHtml(hardness)}">${escapeHtml(hardness)} ${MOHS_SCALE[hardness] ?? ""}</span>`;
}

export function formatO2(tokens) {
  if (tokens >= 1e6) return `${trimZeros((tokens / 1e6).toFixed(2))}M`;
  if (tokens >= 1e3) return `${Math.round(tokens / 1e3)}k`;
  return String(tokens);
}

export function formatDuration(ms) {
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds} s`;
  const minutes = Math.floor(seconds / 60);
  return minutes < 60 ? `${minutes} min` : `${Math.floor(minutes / 60)} h ${minutes % 60} min`;
}

/** Wall-clock time of the climb so far (or until it ended). */
export function elapsed(view) {
  if (!view.startedAt) return "00:00";
  const end = view.endedAt ? Date.parse(view.endedAt) : Date.now();
  const seconds = Math.max(0, Math.round((end - Date.parse(view.startedAt)) / 1000));
  const hours = Math.floor(seconds / 3600);
  const clock = `${pad(Math.floor((seconds % 3600) / 60))}:${pad(seconds % 60)}`;
  return hours ? `${hours}:${clock}` : clock;
}

/** Offset of an event from the start of its climb, as mm:ss. */
export function offset(view, timestamp) {
  const seconds = Math.max(0, Math.round((Date.parse(timestamp) - Date.parse(view.startedAt)) / 1000));
  return `${pad(Math.floor(seconds / 60))}:${pad(seconds % 60)}`;
}

export function shortDate(iso) {
  if (!iso) return "";
  const date = new Date(iso);
  return `${pad(date.getDate())}/${pad(date.getMonth() + 1)} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function trimZeros(decimal) {
  return decimal.replace(/\.?0+$/, "").replace(".", ",");
}

function pad(n) {
  return String(n).padStart(2, "0");
}
