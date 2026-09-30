import { byId, escapeHtml as esc, prefersReducedMotion } from "./dom.js";
import { climbState, elapsed, formatDuration, formatO2, hardnessChip, offset, SEVERITY_ORDER, shortDate } from "./format.js";

const FEED_SIZE = 14;
const FRICTION_SIZE = 10;

export function renderPicker(store) {
  const select = byId("climb-select");
  const climbs = store.sorted();
  select.disabled = climbs.length === 0;
  const html = climbs
    .map(
      (view) =>
        `<option value="${esc(view.id)}"${view.id === store.selectedId ? " selected" : ""}>${esc(shortDate(view.startedAt))} · ${esc(view.request || view.id)} · ${esc(climbState(view.state).label)}</option>`,
    )
    .join("");
  if (select.dataset.html === html) return;
  select.innerHTML = html;
  select.dataset.html = html;
}

export function renderHeader(view) {
  const kind = { variation: "variation", first_ascent: "first ascent" }[view.kind] ?? "";
  byId("c-meta").textContent = [view.project, kind, view.id].filter(Boolean).join(" · ");
  byId("c-request").textContent = view.request || "…";
  byId("c-hardness").innerHTML = view.hardness ? hardnessChip(view.hardness) : "";
  const state = climbState(view.state);
  byId("c-state").textContent = state.label;
  byId("c-state").dataset.tone = state.tone;
}

export function renderMetrics(view) {
  const { used, budget } = view.o2;
  byId("m-time").textContent = elapsed(view);
  byId("m-o2").textContent = formatO2(used);
  byId("m-o2-cap").textContent = budget ? `de ${formatO2(budget)} no cilindro` : "";
  const bar = byId("m-o2-bar");
  bar.style.width = `${(budget ? Math.min(100, (used / budget) * 100) : 0).toFixed(1)}%`;
  bar.classList.toggle("over", budget > 0 && used > budget);
  byId("m-falls").textContent = view.falls;
  byId("m-friction").textContent = view.friction.length;
  byId("m-summit").textContent = `${view.routes.filter((route) => route.state === "summited").length}/${view.routes.length}`;
}

export function renderLegend(view, averages) {
  const legend = byId("legend");
  legend.style.gridTemplateColumns = `repeat(${Math.max(view.routes.length, 1)}, minmax(0, 1fr))`;
  legend.innerHTML = view.routes
    .map(
      (route) => `<div class="lg">
        <span class="lg-id">${esc(route.id)}</span>
        <b>${esc(route.name)}</b>
        ${hardnessChip(route.hardness)}
        <span class="lg-label">${esc(route.label)}</span>
        ${route.branch ? `<span class="lg-o2">${esc(route.branch)}</span>` : ""}
        ${route.evidence ? `<span class="lg-o2" title="${esc(route.evidence.proofs.join(" · "))}">evidência ${esc(route.evidence.grade)}</span>` : ""}
        <span class="lg-o2">O₂ ${formatO2(route.o2)} de ${formatO2(route.budget)}</span>
      </div>`,
    )
    .join("");

  const history = averages?.routes ?? {};
  const known = ["talc", "fluorite", "quartz", "diamond"]
    .filter((h) => history[h]?.count)
    .map((h) => `${h} ${formatDuration(history[h].avgMs)}`);
  byId("avg").textContent = known.length ? `média histórica até o summit: ${known.join(" · ")}` : "sem histórico de summit ainda";
}

export function renderFeed(view, lastSeen) {
  const entries = view.timeline.slice(-FEED_SIZE).reverse();
  byId("feed").innerHTML = entries.length
    ? entries
        .map(
          (entry) => `<li class="${entry.seq > lastSeen && !prefersReducedMotion ? "new" : ""}">
            <span class="t">${esc(offset(view, entry.ts))}</span>
            <div class="l"><span class="tag" data-tone="${esc(entry.tone)}">${esc(entry.tag)}</span><span class="who">${esc(entry.who ?? "")}${entry.route ? ` · route ${esc(entry.route)}` : ""}</span><span class="x">${esc(entry.text)}</span></div>
          </li>`,
        )
        .join("")
    : empty("Nada ainda.");
}

export function renderReport(view) {
  const findings = view.routes.flatMap((route) => route.findings).sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);
  byId("report").innerHTML = findings.length
    ? findings
        .map(
          (f) => `<li class="${f.fixed ? "fixed" : ""}">
            <span class="sev ${esc(f.severity)}">${esc(f.severity)}</span>
            <span class="x">route ${esc(f.route)} · ${esc(f.inspector)}: ${esc(f.text)}${f.file ? ` <span class="who">${esc(f.file)}${f.line ? `:${f.line}` : ""}</span>` : ""}</span>
            <span class="act">${f.fixed ? "fixed" : esc(f.action)}</span>
          </li>`,
        )
        .join("")
    : empty("Nenhum report ainda. Os inspectors gravam aqui depois do send.");
}

export function renderFriction(view) {
  const entries = view.friction.slice(-FRICTION_SIZE).reverse();
  byId("friction").innerHTML = entries.length
    ? entries
        .map(
          (f) =>
            `<li><span class="hx" aria-hidden="true"></span><span>${esc(f.kind)} · ${esc(f.detail)}</span><span class="n">${f.route ? `route ${esc(f.route)}` : ""}${f.pitch ? ` · L${f.pitch}` : ""}</span></li>`,
        )
        .join("")
    : empty("Sem friction até agora.");
}

export function renderDescent(view) {
  byId("descent").hidden = view.proposals.length === 0;
  byId("proposals").innerHTML = view.proposals
    .map(
      (p) =>
        `<li><span class="pid">${esc(p.id)}</span><div><b>${esc(p.summary)}</b><div class="meta">${esc(p.kind)} · ${esc(p.target)} · evidência: ${esc(p.evidence.join("; "))}</div></div></li>`,
    )
    .join("");
}

function empty(text) {
  return `<li class="none">${esc(text)}</li>`;
}
