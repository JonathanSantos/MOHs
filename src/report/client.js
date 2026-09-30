// Desenha o relatório a partir dos dados embutidos. Sem dependências: o arquivo abre offline e publicado.
const DATA = JSON.parse(document.getElementById("report-data").textContent);

const ROLES = {
  human: { label: "humano", color: "var(--rope)" },
  basecamp: { label: "basecamp", color: "var(--basecamp)" },
  scout: { label: "scout", color: "var(--scout)" },
  setter: { label: "setter", color: "var(--setter)" },
  belayer: { label: "belayer", color: "var(--quartz)" },
  climber: { label: "climber", color: "var(--fluorite)" },
  inspector: { label: "inspector", color: "var(--diamond)" },
  scribe: { label: "scribe", color: "var(--scribe)" },
};
const HARDNESS = { talc: "talc 1", fluorite: "fluorite 4", quartz: "quartz 7", diamond: "diamond 10" };
const ANSWERS = {
  plan: "plano",
  line: "line",
  bolts: "bolts",
  seal: "seal",
  safe: "safe",
  watch: "watch",
  rock: "rock",
  fall: "FALL",
  report: "report",
  beta: "beta",
};

const $ = (id) => document.getElementById(id);
const esc = (text) =>
  String(text ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const t0 = Date.parse(DATA.climb.startedAt);
const t1 = Date.parse(DATA.climb.endedAt ?? DATA.climb.startedAt);
const clock = (iso) => {
  const seconds = Math.max(0, Math.round((Date.parse(iso) - t0) / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
};
const duration = (ms) => {
  const seconds = Math.round(ms / 1000);
  return seconds < 90 ? `${seconds} s` : `${Math.round(seconds / 60)} min`;
};
const kilo = (n) => (n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1).replace(".", ",")}k` : String(n));
const roleColor = (role) => (ROLES[role] ?? ROLES.basecamp).color;
const EVIDENCE_TONE = { forte: "ok", média: "ok", fraca: "warn", nenhuma: "crit" };
const hardnessChip = (h) => (h ? `<span class="chip ${esc(h)}">${esc(HARDNESS[h] ?? h)}</span>` : "");

function header() {
  const { climb, tasks, decisions, plan } = DATA;
  const title = climb.request.split(/\n|\. /)[0].slice(0, 90);
  const falls = plan.routes.reduce((n, r) => n + r.falls, 0) + (DATA.delivery?.checks.filter((c) => !c.ok).length ?? 0);
  const human = decisions.filter((d) => d.role === "human").length;
  const state = { done: ["concluído", "ok"], aborted: ["interrompido", "crit"], escalated: ["escalado", "warn"] }[climb.state] ?? [
    climb.state,
    "warn",
  ];
  $("title").textContent = title;
  $("eyebrow").textContent = `MOHs · climb ${climb.id} · ${climb.project}`;
  $("chips").innerHTML = [
    `<span class="chip ${state[1]}">${esc(state[0])}</span>`,
    hardnessChip(climb.hardness),
    climb.kind ? `<span class="chip">${climb.kind === "variation" ? "variation (código existente)" : "first ascent"}</span>` : "",
    `<span class="chip">${plan.routes.length} route(s)</span>`,
  ].join("");
  $("request").textContent = climb.request;
  const tiles = [
    ["Duração", duration(t1 - t0), "do survey ao fim"],
    ["Tarefas", tasks.length, `${new Set(tasks.map((t) => t.agent)).size} agentes`],
    ["Decisões", decisions.length, `${human} humanas`],
    ["Falls", falls, falls ? "o send pegou algo" : "nenhuma"],
    ["Commits", plan.routes.reduce((n, r) => n + (r.commits ?? 0), 0), DATA.delivery?.branch ? "mais a entrega" : "nas routes"],
    ["O₂ entregue", kilo(climb.o2), `de ${kilo(climb.budget)} no cilindro`],
  ];
  $("tiles").innerHTML = tiles
    .map(
      ([label, value, sub]) =>
        `<div class="tile"><span class="label">${label}</span><span class="value">${esc(value)}</span><span class="sub">${esc(sub)}</span></div>`,
    )
    .join("");
}

/** Linha do tempo: fases do Basecamp em cima, uma raia por agente, marcas onde o humano decidiu. */
function timeline() {
  const W = 1000;
  const LEFT = 150;
  const ROW = 26;
  const span = Math.max(1, t1 - t0);
  const x = (iso) => LEFT + ((Date.parse(iso) - t0) / span) * (W - LEFT - 10);
  const agents = [];
  for (const task of [...DATA.tasks].sort((a, b) => Date.parse(a.openedAt) - Date.parse(b.openedAt))) {
    if (!agents.includes(task.agent)) agents.push(task.agent);
  }
  const top = 22;
  const height = top + ROW * (agents.length + 1) + 30;
  const minutes = span / 60000;
  const step = [0.5, 1, 2, 5, 10, 15, 30, 60].find((s) => minutes / s <= 10) ?? 60;
  let svg = "";
  for (let m = 0; m <= minutes + 1e-9; m += step) {
    const gx = LEFT + ((m * 60000) / span) * (W - LEFT - 10);
    svg += `<line class="grid" x1="${gx}" x2="${gx}" y1="${top - 6}" y2="${height - 24}"/><text x="${gx}" y="${height - 8}" text-anchor="middle">${m % 1 ? m.toFixed(1).replace(".", ",") : m} min</text>`;
  }
  svg += `<text class="row-label" x="0" y="${top + 17}">Basecamp</text>`;
  DATA.phases.forEach((phase, i) => {
    const x0 = x(phase.start);
    const x1 = Math.max(x0 + 2, x(phase.end ?? DATA.climb.endedAt));
    const human = phase.name === "Assinatura";
    svg += `<rect x="${x0}" y="${top + 4}" width="${x1 - x0}" height="${ROW - 8}" rx="3" fill="${human ? "var(--rope)" : "var(--basecamp)"}" opacity="${human ? 0.85 : i % 2 ? 0.55 : 0.75}"><title>${esc(phase.name)} · ${clock(phase.start)} → ${phase.end ? clock(phase.end) : "fim"}</title></rect>`;
    if (x1 - x0 > 48) svg += `<text class="bar-label" x="${x0 + 5}" y="${top + ROW / 2 + 3}">${esc(phase.name)}</text>`;
  });
  agents.forEach((agent, row) => {
    const y = top + ROW * (row + 1);
    svg += `<text class="row-label" x="0" y="${y + 17}">${esc(agent.length > 22 ? agent.slice(0, 21) + "…" : agent)}</text>`;
    for (const task of DATA.tasks.filter((t) => t.agent === agent)) {
      const x0 = x(task.openedAt);
      const x1 = Math.max(x0 + 3, x(task.closedAt ?? DATA.climb.endedAt));
      const tip = `${task.id} · ${task.role}${task.route ? ` · route ${task.route}` : ""} · ${task.title} · ${task.closedAt ? duration(Date.parse(task.closedAt) - Date.parse(task.openedAt)) : "aberta"}${task.answered ? ` · terminou com ${ANSWERS[task.answered] ?? task.answered}` : ""}`;
      svg += `<rect class="task" x="${x0}" y="${y + 4}" width="${x1 - x0}" height="${ROW - 8}" rx="3" fill="${roleColor(task.role)}"><title>${esc(tip)}</title></rect>`;
      if (x1 - x0 > 26) svg += `<text class="bar-label" x="${x0 + 4}" y="${y + ROW / 2 + 3}">${esc(task.id)}</text>`;
    }
  });
  for (const decision of DATA.decisions.filter((d) => d.role === "human")) {
    const hx = x(decision.ts);
    svg += `<line x1="${hx}" x2="${hx}" y1="${top}" y2="${height - 24}" stroke="var(--rope)" stroke-dasharray="3 3"/><rect x="${hx - 4}" y="${top - 12}" width="8" height="8" fill="var(--rope)" transform="rotate(45 ${hx} ${top - 8})"><title>${esc(decision.title)} · ${clock(decision.ts)}</title></rect>`;
  }
  $("gantt").innerHTML = `<svg class="gantt" viewBox="0 0 ${W} ${height}" role="img" aria-label="Linha do tempo do climb">${svg}</svg>`;
  $("legend").innerHTML = Object.entries(ROLES)
    .map(([, { label, color }]) => `<span><i style="background:${color}"></i>${label}</span>`)
    .join("");
}

function plan() {
  const { routes, windows, reason } = DATA.plan;
  $("plan-reason").textContent = reason ?? "";
  const columns = windows.length ? windows : [routes.map((r) => r.id)];
  $("windows").innerHTML = columns
    .map((ids, i) => {
      const cards = ids
        .map((id) => routes.find((r) => r.id === id))
        .filter(Boolean)
        .map(routeCard)
        .join("");
      return `<div class="window"><span class="label">Janela ${i + 1}${ids.length > 1 ? " · em paralelo" : ""}</span>${cards}</div>`;
    })
    .join("");
}

function routeCard(route) {
  const state = { summited: ["summit", "ok"], abandoned: ["abandonada", "crit"] }[route.state] ?? [route.state, "warn"];
  const pitches = route.pitches
    .map(
      (p, i) =>
        `<li><span class="n">${i + 1}</span><span>${esc(p.title)}${p.crux ? ' <span class="chip warn">crux</span>' : ""}${p.retries ? ` <span class="chip warn">${p.retries} nova(s) tentativa(s)</span>` : ""}</span></li>`,
    )
    .join("");
  const facts = [
    route.after.length ? `<span class="chip">parte de ${esc(route.after.join(", "))}</span>` : "",
    route.seal ? `<span class="chip quartz">seal ${route.seal.unit} unit + ${route.seal.e2e} e2e</span>` : "",
    route.falls ? `<span class="chip crit">${route.falls} fall(s)</span>` : "",
    route.findings.length ? `<span class="chip diamond">${route.findings.length} achado(s)</span>` : "",
    route.commits ? `<span class="chip">${route.commits} commit(s)</span>` : "",
    route.evidence
      ? `<span class="chip ${EVIDENCE_TONE[route.evidence.grade] ?? ""}" title="${esc(route.evidence.proofs.join(" · "))}">evidência ${esc(route.evidence.grade)}</span>`
      : "",
  ].join("");
  return `<article class="route"><header><span class="id">${esc(route.id)}</span><h3>${esc(route.name)}</h3></header>
    <div class="facts">${hardnessChip(route.hardness)}<span class="chip ${state[1]}">${esc(state[0])}</span>${facts}</div>
    <ol class="pitches">${pitches}</ol>
    <div class="files">${esc(route.files.join(" · "))}</div>
    ${route.branch ? `<div class="files">${esc(route.branch)}</div>` : ""}</article>`;
}

function decisions() {
  const roles = [...new Set(DATA.decisions.map((d) => d.role))];
  let active = "todas";
  const render = () => {
    $("decision-list").innerHTML = DATA.decisions
      .filter((d) => active === "todas" || d.role === active)
      .map(
        (d) => `<li class="decision ${d.tone} ${d.role === "human" ? "human" : ""}">
          <span class="t">${clock(d.ts)}</span><span class="dot" style="background:${roleColor(d.role)}"></span>
          <div><div class="who">${esc(d.who)}</div><div class="title">${esc(d.title)}</div>${d.detail ? `<div class="detail">${esc(d.detail)}</div>` : ""}</div></li>`,
      )
      .join("");
    for (const button of $("filters").querySelectorAll("button"))
      button.setAttribute("aria-pressed", String(button.dataset.role === active));
  };
  $("filters").innerHTML = ["todas", ...roles]
    .map(
      (role) =>
        `<button type="button" id="filter-${esc(role)}" data-role="${esc(role)}">${esc(role === "todas" ? "todas" : (ROLES[role]?.label ?? role))}</button>`,
    )
    .join("");
  $("filters").addEventListener("click", (event) => {
    const button = event.target.closest("button");
    if (!button) return;
    active = button.dataset.role;
    render();
  });
  render();
}

function line() {
  const line = DATA.line;
  if (!line) return ($("line-section").hidden = true);
  const waited = line.draftedAt && line.signedAt ? duration(Date.parse(line.signedAt) - Date.parse(line.draftedAt)) : "?";
  $("line-facts").innerHTML = [
    `<span class="chip">${line.scenarios} cenário(s) QUANDO/ENTÃO</span>`,
    `<span class="chip">${line.decisions.length} decisão(ões) a confirmar</span>`,
    line.signedBy
      ? `<span class="chip ok">assinada por ${esc(line.signedBy)} em ${waited}</span>`
      : `<span class="chip warn">sem assinatura</span>`,
    line.drafts > 1 ? `<span class="chip warn">${line.drafts} rascunhos</span>` : "",
  ].join("");
  $("line-decisions").innerHTML = line.decisions.length
    ? line.decisions.map((d) => `<li>${esc(d)}</li>`).join("")
    : "<li class='muted'>A line não listou decisões em aberto.</li>";
}

function delivery() {
  const d = DATA.delivery;
  const routes = DATA.plan.routes;
  if (!d) {
    const branches = routes.filter((r) => r.branch);
    $("delivery-flow").innerHTML = branches.map((r) => `<span class="node">${esc(r.branch)}</span>`).join("");
    $("delivery-text").textContent =
      routes.length > 1 ? "As routes foram entregues em branches separadas, sem integração." : "Uma route só: a branch dela é a entrega.";
    $("delivery-command").hidden = branches.length !== 1;
    if (branches.length === 1) setCommand(`git merge ${branches[0].branch}`);
    return;
  }
  const nodes = d.merged.map((id) => `<span class="node">route ${esc(id)}</span>`).join('<span class="arrow">+</span>');
  $("delivery-flow").innerHTML = `${nodes}<span class="arrow">→</span><span class="node final">${esc(d.branch ?? "entrega")}</span>`;
  const checks = d.checks
    .map((c) => `tentativa ${c.attempt}: ${c.ok ? `${c.total} checagens limpas` : `${c.failed} de ${c.total} falharam`}`)
    .join("; ");
  $("delivery-text").textContent =
    `${d.conflicts ? `${d.conflicts} conflito(s) de merge resolvido(s) por um climber. ` : "Os merges não deram conflito. "}Checagem da entrega (todos os selados, a anchor e a suíte): ${checks || "não rodou"}.`;
  if (d.branch) setCommand(`git merge ${d.branch}`);
  else $("delivery-command").hidden = true;
}

function setCommand(text) {
  $("command-text").textContent = text;
  $("copy").addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(text);
      $("copy").textContent = "Copiado";
    } catch {
      const range = document.createRange();
      range.selectNodeContents($("command-text"));
      getSelection().removeAllRanges();
      getSelection().addRange(range);
    }
  });
}

function bars(container, rows, color) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  $(container).innerHTML = rows
    .map(
      (r) =>
        `<div><div class="bar-row"><span>${esc(r.label)}</span><div class="bar-track"><div class="bar-fill" style="width:${(r.value / max) * 100}%;background:${r.color ?? color}"></div></div><span class="n">${esc(r.shown ?? r.value)}</span></div>${r.samples?.length ? `<ul class="samples">${r.samples.map((s) => `<li>${esc(s)}</li>`).join("")}</ul>` : ""}</div>`,
    )
    .join("");
}

function costs() {
  const byRole = Object.entries(DATA.o2ByRole).sort((a, b) => b[1] - a[1]);
  bars(
    "o2",
    byRole.map(([role, value]) => ({ label: ROLES[role]?.label ?? role, value, shown: kilo(value), color: roleColor(role) })),
  );
  const time = {};
  for (const task of DATA.tasks) {
    if (!task.closedAt) continue;
    time[task.role] = (time[task.role] ?? 0) + (Date.parse(task.closedAt) - Date.parse(task.openedAt));
  }
  bars(
    "task-time",
    Object.entries(time)
      .sort((a, b) => b[1] - a[1])
      .map(([role, value]) => ({ label: ROLES[role]?.label ?? role, value, shown: duration(value), color: roleColor(role) })),
  );
  if (DATA.friction.length) {
    bars(
      "friction",
      DATA.friction.map((f) => ({ label: f.kind, value: f.count, samples: f.samples })),
      "var(--warn)",
    );
  } else $("friction").innerHTML = "<p class='muted'>Nenhuma friction registrada.</p>";
  const proposals = DATA.proposals;
  $("proposals").innerHTML = proposals.length
    ? proposals
        .map(
          (p) =>
            `<li><span class="chip ${p.status === "accepted" ? "ok" : p.status === "rejected" ? "" : "warn"}">${esc(p.status === "pending" ? "pendente" : p.status === "accepted" ? "aceita" : "recusada")}</span> <strong>${esc(p.id)}</strong> · ${esc(p.kind)} · ${esc(p.summary)}</li>`,
        )
        .join("")
    : "<li class='muted'>O scribe não propôs nada (ou o climb não teve descent).</li>";
}

header();
timeline();
plan();
decisions();
line();
delivery();
costs();
