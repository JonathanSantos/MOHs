const SVG_NS = "http://www.w3.org/2000/svg";

export const byId = (id) => document.getElementById(id);

export function svg(name, attributes = {}) {
  const node = document.createElementNS(SVG_NS, name);
  for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, String(value));
  return node;
}

/** Escapes everything that came from an event: agent text is never trusted as HTML. */
export function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
}

export const prefersReducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;

let toastTimer;
export function toast(text, tone = "ok") {
  const element = byId("toast");
  element.textContent = text;
  element.dataset.tone = tone;
  element.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (element.hidden = true), 4000);
}
