import { ARMS } from "./arms.ts";
import type { ArmResult, RunInfo } from "./validate.ts";

export interface ReportInput {
  info: RunInfo;
  results: ArmResult[];
  decisions: Record<string, { at: string; text: string }[]>;
  relatos: Record<string, string>;
}

const esc = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** One metric compared across arms: the bar length is the value over the largest one. */
interface Metric {
  label: string;
  /** What "better" means, for the reader. */
  hint: string;
  value(result: ArmResult): number | undefined;
  format(value: number): string;
}

const METRICS: Metric[] = [
  {
    label: "Suíte escondida",
    hint: "maior é melhor",
    value: (r) => (r.hidden.total ? (r.hidden.pass / r.hidden.total) * 100 : undefined),
    format: (v) => `${Math.round(v)}%`,
  },
  { label: "Tokens", hint: "menor é melhor", value: (r) => r.usage?.tokens, format: (v) => `${Math.round(v / 1000)}k` },
  {
    label: "Tempo de relógio",
    hint: "menor é melhor",
    value: (r) => (r.usage ? r.usage.ms / 1000 : undefined),
    format: (v) => `${Math.round(v)} s`,
  },
  { label: "Minutos humanos", hint: "menor é melhor", value: (r) => r.climb?.humanMinutes, format: (v) => `${v} min` },
  { label: "Linhas mudadas", hint: "contexto", value: (r) => r.diff.added + r.diff.removed, format: (v) => `${v}` },
];

/** The comparison page of one validation: who passed the hidden suite, at what cost, and what each arm decided. */
export function renderValidationReport({ info, results, decisions, relatos }: ReportInput): string {
  const cards = results.map((r) => card(r)).join("");
  const bars = METRICS.map((metric) => metricBlock(metric, results)).join("");
  const rows = results.map(tableRow).join("");
  const details = results.map((r) => armDetails(r, decisions[r.name] ?? [], relatos[r.name])).join("");
  const versions = Object.entries(info.mohs)
    .map(
      ([ref, v]) =>
        `<span class="chip">MOHs ${esc(ref === "working" ? "do repositório" : ref)} · ${esc(v.commit)}${v.dirty ? " +mudanças" : ""}</span>`,
    )
    .join("");
  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Validação ${esc(info.name)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Archivo:wdth,wght@62..125,400..900&family=IBM+Plex+Sans:wght@400;500;600&family=Martian+Mono:wght@400;500&display=swap">
<style>${CSS}</style>
</head>
<body>
<main>
  <header>
    <span class="eyebrow">Validação · ${esc(info.name)}</span>
    <h1>${esc(info.request)}</h1>
    <div class="chips"><span class="chip">${esc(info.createdAt.slice(0, 16).replace("T", " "))}</span><span class="chip">template ${esc(info.template)}</span>${versions}<span class="chip">${results.length} braço(s)</span></div>
  </header>
  <section><h2>Resultado</h2><div class="cards">${cards}</div></section>
  <section><h2>Comparação</h2><div class="metrics">${bars}</div></section>
  <section><h2>Tudo, por braço</h2><div class="scroll"><table>
    <thead><tr><th>Braço</th><th>Oculta</th><th>Projeto</th><th>Diff</th><th>Tokens</th><th>Ferramentas</th><th>Tempo</th><th>Humano</th><th>Climb</th></tr></thead>
    <tbody>${rows}</tbody>
  </table></div></section>
  <section><h2>O que cada braço fez</h2>${details}</section>
  <footer>Protocolo: docs/VALIDATION.md · uma rodada é indício; para afirmar diferença, pelo menos 3 repetições por braço.</footer>
</main>
</body>
</html>
`;
}

function card(r: ArmResult): string {
  const arm = ARMS[r.arm];
  const ok = r.hidden.total > 0 && r.hidden.pass === r.hidden.total;
  const kind = arm?.usesMohs ? "mohs" : "plain";
  return `<article class="card ${kind}">
  <span class="label">${esc(arm?.label ?? r.arm)}${r.ref ? ` · ${esc(r.ref)}` : ""}</span>
  <span class="name">${esc(r.name)}</span>
  <span class="big ${ok ? "ok" : "crit"}">${r.hidden.pass}/${r.hidden.total}</span>
  <span class="sub">suíte escondida</span>
  <dl>
    <div><dt>tokens</dt><dd>${r.usage ? `${Math.round(r.usage.tokens / 1000)}k` : "—"}</dd></div>
    <div><dt>tempo</dt><dd>${r.usage ? `${Math.round(r.usage.ms / 1000)} s` : "—"}</dd></div>
    <div><dt>humano</dt><dd>${r.climb ? `${r.climb.humanMinutes} min` : "—"}</dd></div>
  </dl>
</article>`;
}

function metricBlock(metric: Metric, results: ArmResult[]): string {
  const values = results.map((r) => metric.value(r));
  const max = Math.max(...values.map((v) => v ?? 0), 1);
  const rows = results
    .map((r, i) => {
      const value = values[i];
      const width = !value ? 0 : Math.max(2, (value / max) * 100);
      const kind = ARMS[r.arm]?.usesMohs ? "mohs" : "plain";
      return `<div class="bar-row"><span class="bar-name">${esc(r.name)}</span><span class="bar-track"><span class="bar ${kind}" style="width:${width.toFixed(1)}%"></span></span><span class="bar-value">${value === undefined ? "—" : metric.format(value)}</span></div>`;
    })
    .join("");
  return `<div class="metric"><h3>${esc(metric.label)} <small>${esc(metric.hint)}</small></h3>${rows}</div>`;
}

function tableRow(r: ArmResult): string {
  const project = r.project ? `${r.project.pass}/${r.project.pass + r.project.fail}` : "—";
  const climb = r.climb
    ? `${esc(r.climb.state)} · ${esc(r.climb.hardness ?? "?")} · ${r.climb.tasks} tarefas${r.climb.falls ? ` · ${r.climb.falls} fall(s)` : ""}${r.climb.disputes ? ` · ${r.climb.disputes} contestação(ões)` : ""}${r.climb.evidence.length ? ` · evidência ${esc(r.climb.evidence.join(", "))}` : ""}`
    : "—";
  return `<tr><td><strong>${esc(r.name)}</strong></td><td>${r.hidden.pass}/${r.hidden.total}</td><td>${project}</td><td>${r.diff.files} arq. (+${r.diff.added}/−${r.diff.removed})</td><td>${r.usage ? `${Math.round(r.usage.tokens / 1000)}k` : "—"}${r.usageParts > 1 ? ` <small>(${r.usageParts} parcelas)</small>` : ""}</td><td>${r.usage?.tools ?? "—"}</td><td>${r.usage ? `${Math.round(r.usage.ms / 1000)} s` : "—"}</td><td>${r.climb ? `${r.climb.humanMinutes} min` : "—"}</td><td>${climb}</td></tr>`;
}

function armDetails(r: ArmResult, decisions: { at: string; text: string }[], relato: string | undefined): string {
  const failing = r.hidden.failing.length
    ? `<p class="crit-text">Falhou na suíte escondida: ${r.hidden.failing.map(esc).join("; ")}</p>`
    : "";
  const human = decisions.length
    ? `<h4>O que o humano decidiu</h4><ul>${decisions.map((d) => `<li><span class="mono">${esc(d.at.slice(11, 16))}</span> ${esc(d.text)}</li>`).join("")}</ul>`
    : "";
  const climb = r.climb
    ? `<p class="mono small">climb ${esc(r.climb.id)} · ${esc(r.climb.state)} · trilha ${esc(r.climb.hardness ?? "?")} · ${r.climb.routes} route(s) · ${r.climb.tasks} tarefas · O₂ ${Math.round(r.climb.o2 / 1000)}k · line com ${r.climb.lineLines} linhas${r.climb.decisions ? ` · ${r.climb.decisions} decisão(ões) do climber` : ""}${r.workingCopyIntact === false ? " · working copy alterado!" : ""}</p>`
    : "";
  return `<details class="arm" ${failing ? "open" : ""}>
  <summary><strong>${esc(r.name)}</strong> <span class="muted">${esc(ARMS[r.arm]?.measures ?? "")}</span></summary>
  <p class="small">Entrega julgada: <span class="mono">${esc(r.delivered)}</span></p>
  ${failing}${climb}${human}
  ${relato ? `<h4>Relato do subagente</h4><pre>${esc(relato)}</pre>` : ""}
</details>`;
}

const CSS = `
:root {
  --chalk:#F3F4F1; --granite:#E7E8E3; --granite-2:#D9DBD4; --graphite:#1A1D20; --slate:#596068; --vein:#CBCDC6;
  --rope:#E4531B; --ok:#2C7D52; --ok-bg:#DCEEE3; --crit:#B83227; --crit-bg:#F6DCD8;
  --f-display:"Archivo","Arial Narrow","Helvetica Neue",Arial,sans-serif;
  --f-body:"IBM Plex Sans","Helvetica Neue",Arial,sans-serif;
  --f-mono:"Martian Mono",ui-monospace,"SFMono-Regular",Menlo,Consolas,monospace;
}
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    --chalk:#101214; --granite:#191C1F; --granite-2:#262A2E; --graphite:#E6E7E2; --slate:#9CA3AA; --vein:#2E3237;
    --rope:#FF6B30; --ok:#5CC98E; --ok-bg:#16291F; --crit:#F2685C; --crit-bg:#34181A; color-scheme: dark;
  }
}
:root[data-theme="dark"] {
  --chalk:#101214; --granite:#191C1F; --granite-2:#262A2E; --graphite:#E6E7E2; --slate:#9CA3AA; --vein:#2E3237;
  --rope:#FF6B30; --ok:#5CC98E; --ok-bg:#16291F; --crit:#F2685C; --crit-bg:#34181A; color-scheme: dark;
}
* { box-sizing: border-box; }
body { margin: 0; background: var(--chalk); color: var(--graphite); font: 15px/1.55 var(--f-body); }
main { max-width: 1080px; margin: 0 auto; padding: 40px 16px 64px; display: grid; gap: 40px; }
header { display: grid; gap: 12px; }
.eyebrow, .label, .mono, dt, small, footer { font-family: var(--f-mono); }
.eyebrow { font-size: 12px; letter-spacing: .1em; text-transform: uppercase; color: var(--slate); }
h1 { font: 800 clamp(28px, 4vw, 40px)/1.05 var(--f-display); font-stretch: 75%; margin: 0; text-wrap: balance; }
h2 { font: 800 24px/1.1 var(--f-display); font-stretch: 80%; margin: 0 0 14px; }
h3 { font: 700 15px var(--f-body); margin: 0 0 8px; }
h3 small { font-weight: 400; color: var(--slate); font-size: 11px; margin-left: 6px; }
h4 { font: 600 13px var(--f-body); margin: 14px 0 6px; }
.chips { display: flex; flex-wrap: wrap; gap: 8px; }
.chip { font: 11px var(--f-mono); padding: 3px 9px; border-radius: 999px; background: var(--granite); color: var(--slate); }
.cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(190px, 1fr)); gap: 12px; }
.card { background: var(--granite); border-radius: 6px; padding: 16px; display: grid; gap: 2px; border-top: 4px solid var(--slate); min-width: 0; }
.card.mohs { border-top-color: var(--rope); }
.label { font-size: 11px; color: var(--slate); }
.name { font: 700 14px var(--f-mono); overflow-wrap: anywhere; }
.big { font: 900 46px/1 var(--f-display); margin-top: 10px; font-variant-numeric: tabular-nums; }
.big.ok { color: var(--ok); } .big.crit { color: var(--crit); }
.sub { font-size: 12px; color: var(--slate); }
dl { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 6px; margin: 12px 0 0; }
dt { font-size: 10px; color: var(--slate); } dd { margin: 0; font-weight: 600; font-variant-numeric: tabular-nums; }
.metrics { display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 22px 32px; }
.bar-row { display: grid; grid-template-columns: minmax(80px, 120px) minmax(0, 1fr) 64px; gap: 10px; align-items: center; font-size: 13px; margin: 5px 0; }
.bar-name { font: 12px var(--f-mono); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.bar-track { height: 12px; background: var(--granite); border-radius: 2px; overflow: hidden; }
.bar { display: block; height: 100%; background: var(--slate); }
.bar.mohs { background: var(--rope); }
.bar-value { text-align: right; font-variant-numeric: tabular-nums; font-weight: 600; }
.scroll { overflow-x: auto; }
table { border-collapse: collapse; width: 100%; font-size: 13px; }
th, td { text-align: left; padding: 8px 10px 8px 0; border-bottom: 1px solid var(--vein); vertical-align: top; }
th { font: 600 11px var(--f-mono); color: var(--slate); text-transform: uppercase; letter-spacing: .04em; }
.arm { border-top: 1px solid var(--vein); padding: 12px 0; }
.arm summary { cursor: pointer; }
.muted { color: var(--slate); font-size: 13px; }
.small { font-size: 12px; }
.crit-text { color: var(--crit); background: var(--crit-bg); padding: 8px 10px; border-radius: 4px; font-size: 13px; }
pre { white-space: pre-wrap; background: var(--granite); padding: 12px; border-radius: 4px; font: 12px/1.5 var(--f-mono); overflow-x: auto; }
footer { font-size: 11px; color: var(--slate); border-top: 1px solid var(--vein); padding-top: 14px; }
:focus-visible { outline: 2px solid var(--rope); outline-offset: 2px; }
`;
