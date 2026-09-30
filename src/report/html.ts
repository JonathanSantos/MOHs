import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { ReportData } from "./data.ts";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const FONTS =
  "https://fonts.googleapis.com/css2?family=Archivo:wdth,wght@62..125,400..900&family=IBM+Plex+Sans:wght@400;500;600&family=Martian+Mono:wght@400;500&display=swap";

export interface ReportOptions {
  title?: string;
  /** Trusted HTML shown right after the summary: context the climb log does not have (a test setup, a comparison). */
  annex?: string;
  /** Only the page's content, for hosts that wrap it in their own document. */
  fragment?: boolean;
}

/** One self-contained page: styles, data and script inline, so it opens offline and can be published as is. */
export function renderReport(data: ReportData, options: ReportOptions = {}): string {
  const css = readFileSync(`${HERE}report.css`, "utf8");
  const js = readFileSync(`${HERE}client.js`, "utf8");
  // O JSON vai dentro de <script>: "</" viraria o fim do script, então é escapado.
  const json = JSON.stringify(data).replace(/<\//g, "<\\/");
  const title = escapeHtml(options.title ?? `Climb ${data.climb.project}`);
  const content = `<title>${title}</title>
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link rel="stylesheet" href="${FONTS}" />
<style>
${css}
</style>
<main>
  <header>
    <span class="eyebrow" id="eyebrow"></span>
    <h1 id="title"></h1>
    <div class="chips" id="chips"></div>
    <details class="request"><summary>Pedido completo</summary><p id="request"></p></details>
    <div class="tiles" id="tiles"></div>
  </header>
${options.annex ? `  <section class="annex">${options.annex}</section>\n` : ""}
  <section aria-labelledby="h-timeline">
    <h2 id="h-timeline">Como o climb andou</h2>
    <p class="muted">Cada barra é uma tarefa, na raia do agente que a fez. A primeira raia são as fases do Basecamp; os losangos laranja são decisões humanas. Passe o mouse para ver cada tarefa.</p>
    <div class="legend" id="legend"></div>
    <div class="scroll" id="gantt"></div>
  </section>

  <section aria-labelledby="h-plan">
    <h2 id="h-plan">O plano do scout</h2>
    <p id="plan-reason"></p>
    <div class="windows" id="windows"></div>
  </section>

  <section aria-labelledby="h-decisions">
    <h2 id="h-decisions">Decisões, em ordem</h2>
    <p class="muted">Tudo o que mudou o rumo do climb, de quem e quando (minutos desde o início).</p>
    <div class="filters" id="filters" role="group" aria-label="Filtrar por papel"></div>
    <ol class="decisions" id="decision-list"></ol>
  </section>

  <div class="split">
    <section id="line-section" aria-labelledby="h-line">
      <h2 id="h-line">A line que o humano assinou</h2>
      <div class="chips" id="line-facts"></div>
      <h3>Decisões</h3>
      <ol class="numbered" id="line-decisions"></ol>
    </section>
    <section aria-labelledby="h-delivery">
      <h2 id="h-delivery">A entrega</h2>
      <div class="flow" id="delivery-flow"></div>
      <p id="delivery-text"></p>
      <div class="command" id="delivery-command"><code id="command-text"></code><button type="button" id="copy">Copiar</button></div>
    </section>
  </div>

  <div class="split">
    <section aria-labelledby="h-o2">
      <h2 id="h-o2">O₂ por papel</h2>
      <p class="muted">O pack que o MOHs entregou a cada papel. Com agentes externos, o gasto real deles fica de fora.</p>
      <div class="bars" id="o2"></div>
      <h3>Tempo em tarefas</h3>
      <div class="bars" id="task-time"></div>
    </section>
    <section aria-labelledby="h-friction">
      <h2 id="h-friction">Atrito e propostas</h2>
      <div class="bars" id="friction"></div>
      <h3>O que o scribe propôs</h3>
      <ul class="numbered" id="proposals"></ul>
    </section>
  </div>

  <footer>Gerado por <code>mohs report</code> a partir do log de eventos do climb. O conteúdo dos testes selados nunca entra neste relatório.</footer>
</main>
<script type="application/json" id="report-data">${json}</script>
<script>
${js}
</script>`;
  if (options.fragment) return content;
  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
</head>
<body>
${content}
</body>
</html>
`;
}

function escapeHtml(text: string): string {
  return text.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
}
