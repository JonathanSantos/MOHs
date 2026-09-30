// Gera as imagens do README com os tokens da identidade (docs/identidade.html), em versão clara e escura.
// Uso: node docs/assets/readme/render.ts
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const HERE = fileURLToPath(new URL(".", import.meta.url));

interface Tokens {
  chalk: string;
  granite: string;
  granite2: string;
  graphite: string;
  slate: string;
  vein: string;
  rope: string;
  crit: string;
  warn: string;
  minerals: Record<Mineral, { main: string; bg: string; fg: string }>;
}

type Mineral = "talc" | "fluorite" | "quartz" | "diamond";

const LIGHT: Tokens = {
  chalk: "#F3F4F1",
  granite: "#E7E8E3",
  granite2: "#D9DBD4",
  graphite: "#1A1D20",
  slate: "#596068",
  vein: "#CBCDC6",
  rope: "#E4531B",
  crit: "#B83227",
  warn: "#94660B",
  minerals: {
    talc: { main: "#8A8577", bg: "#EBE8E1", fg: "#45413A" },
    fluorite: { main: "#5E8F72", bg: "#DDEBE2", fg: "#244A36" },
    quartz: { main: "#B85E76", bg: "#F4DEE4", fg: "#6E2539" },
    diamond: { main: "#2A83A8", bg: "#D5ECF4", fg: "#114A63" },
  },
};

const DARK: Tokens = {
  chalk: "#101214",
  granite: "#191C1F",
  granite2: "#262A2E",
  graphite: "#E6E7E2",
  slate: "#9CA3AA",
  vein: "#2E3237",
  rope: "#FF6B30",
  crit: "#F2685C",
  warn: "#E3B04B",
  minerals: {
    talc: { main: "#B8B2A3", bg: "#2A2823", fg: "#E2DDD1" },
    fluorite: { main: "#86C29E", bg: "#1B2E23", fg: "#BFE6CD" },
    quartz: { main: "#E594AA", bg: "#35202A", fg: "#F7CCD8" },
    diamond: { main: "#62BFE2", bg: "#132C37", fg: "#BCE5F4" },
  },
};

const DISPLAY = `Archivo, 'Arial Narrow', 'Helvetica Neue', Arial, sans-serif`;
const BODY = `'IBM Plex Sans', 'Helvetica Neue', Arial, sans-serif`;
const MONO = `'Martian Mono', ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`;

/** The identity's pictograms (24×24), one per climb stage. */
const ICONS: Record<string, string> = {
  base: `<path d="M3.5 19.5 L12 5 L20.5 19.5 Z M12 19.5 V13.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/>`,
  croqui: `<rect x="4" y="5" width="16" height="14" rx="1" fill="none" stroke="currentColor" stroke-width="1.6" stroke-dasharray="3 2"/><path d="M7 16 L10 11 L13 13.5 L17 8" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/>`,
  tracado: `<path d="M5 20 C9 16, 7 10, 12 9 S 16 6, 18.5 4.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><circle cx="18.5" cy="4.5" r="2" fill="currentColor"/>`,
  grampo: `<path d="M7 7 L17 17 M17 7 L7 17" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>`,
  selo: `<path d="M12 3 L19.5 7.5 V16.5 L12 21 L4.5 16.5 V7.5 Z M12 3 V21 M4.5 7.5 L19.5 16.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/>`,
  parada: `<circle cx="12" cy="12" r="6" fill="none" stroke="currentColor" stroke-width="2"/>`,
  cadena: `<circle cx="12" cy="12" r="8" fill="none" stroke="currentColor" stroke-width="1.6"/><circle cx="12" cy="12" r="3.6" fill="currentColor"/>`,
  vistoria: `<circle cx="12" cy="12" r="8.5" fill="none" stroke="currentColor" stroke-width="1.6"/><circle cx="8.4" cy="12" r="1.5" fill="currentColor"/><circle cx="12" cy="12" r="1.5" fill="currentColor"/><circle cx="15.6" cy="12" r="1.5" fill="currentColor"/>`,
  cume: `<path d="M7 21 V3.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M7 4 L18.5 7.5 L7 11 Z" fill="currentColor"/>`,
  descida: `<path d="M7 5 L12 10 L17 5 M7 12.5 L12 17.5 L17 12.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>`,
};

const esc = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function icon(name: string, x: number, y: number, size: number, color: string): string {
  return `<g transform="translate(${x} ${y}) scale(${size / 24})" color="${color}">${ICONS[name]}</g>`;
}

function svg(width: number, height: number, title: string, t: Tokens, body: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img" aria-label="${esc(title)}">
<title>${esc(title)}</title>
<rect width="${width}" height="${height}" rx="10" fill="${t.chalk}"/>
${body}
</svg>
`;
}

/** Wordmark, the Mohs ruler with the four tracks lit, and the thesis. */
function hero(t: Tokens): string {
  const lit: Partial<Record<number, Mineral>> = { 1: "talc", 4: "fluorite", 7: "quartz", 10: "diamond" };
  const names = ["talc", "gypsum", "calcite", "fluorite", "apatite", "orthoclase", "quartz", "topaz", "corundum", "diamond"];
  const col = (880 - 9 * 8) / 10;
  const ticks = names
    .map((name, i) => {
      const n = i + 1;
      const x = 40 + i * (col + 8);
      const height = 6 + n * 8;
      const mineral = lit[n];
      const fill = mineral ? t.minerals[mineral].main : t.granite2;
      const label = mineral ? t.minerals[mineral].main : t.slate;
      return `<rect x="${x}" y="${326 - height}" width="${col}" height="${height}" fill="${fill}"/>
<rect x="${x}" y="332" width="${col}" height="2" fill="${t.graphite}"/>
<text x="${x}" y="352" font-family="${MONO}" font-size="12" font-weight="500" fill="${t.graphite}">${n}</text>
<text x="${x}" y="370" font-family="${MONO}" font-size="11" font-weight="${mineral ? 600 : 400}" fill="${label}">${name}</text>`;
    })
    .join("\n");
  const thesis = ["Arnês para agentes", "de código. Duro como", "diamante, leve em tokens."]
    .map(
      (line, i) =>
        `<text x="520" y="${122 + i * 38}" font-family="${DISPLAY}" font-size="34" font-weight="800" font-stretch="condensed" fill="${t.graphite}">${line}</text>`,
    )
    .join("\n");
  return svg(
    960,
    400,
    "MOHs, My Own Harness System: arnês para agentes de código",
    t,
    `<text x="40" y="44" font-family="${MONO}" font-size="12" letter-spacing="1.5" fill="${t.slate}">MY OWN HARNESS SYSTEM · TYPESCRIPT · NODE 24</text>
<text x="34" y="222" font-family="${DISPLAY}" font-size="196" font-weight="900" font-stretch="condensed" textLength="440" lengthAdjust="spacingAndGlyphs" fill="${t.graphite}">M<tspan fill="none" stroke="${t.rope}" stroke-width="11">O</tspan>Hs</text>
${thesis}
<text x="520" y="232" font-family="${BODY}" font-size="14" fill="${t.slate}">O fluxo é código. O agente faz a tarefa da vez.</text>
${ticks}`,
  );
}

interface Stage {
  name: string;
  note: string;
  icon: string;
  human?: string;
  tracks?: string;
}

/** The climb from survey to descent, rising like a route, with the human gates marked. */
function flow(t: Tokens): string {
  const stages: Stage[] = [
    { name: "Survey", note: "mapa, por código", icon: "croqui" },
    { name: "Scout", note: "plano e trilha", icon: "base" },
    { name: "Line", note: "a spec", icon: "tracado", human: "você assina" },
    { name: "Bolts", note: "contrato", icon: "grampo", tracks: "quartz+" },
    { name: "Seal", note: "testes ocultos", icon: "selo", tracks: "quartz+" },
    { name: "Pitches", note: "anchor e commit", icon: "parada" },
    { name: "Send", note: "roda o seal", icon: "cadena", tracks: "quartz+" },
    { name: "Inspection", note: "revisores", icon: "vistoria", tracks: "quartz+" },
    { name: "Summit", note: "a entrega", icon: "cume", human: "talc e diamond" },
    { name: "Descent", note: "retrospectiva", icon: "descida", tracks: "quartz+" },
  ];
  const x = (i: number) => 70 + i * 91;
  const y = (i: number) => 300 - i * 21;
  const rope = stages.map((_, i) => `${i ? "L" : "M"} ${x(i)} ${y(i)}`).join(" ");
  const nodes = stages
    .map((stage, i) => {
      const cx = x(i);
      const cy = y(i);
      const human = stage.human
        ? `<path d="M ${cx} ${cy - 44} l 6 6 l -6 6 l -6 -6 Z" fill="${t.rope}"/>
<text x="${cx}" y="${cy - 52}" text-anchor="middle" font-family="${MONO}" font-size="10" font-weight="600" fill="${t.rope}">${stage.human}</text>`
        : "";
      const tracks = stage.tracks
        ? `<text x="${cx}" y="${cy + 70}" text-anchor="middle" font-family="${MONO}" font-size="9.5" fill="${t.minerals.quartz.main}">${stage.tracks}</text>`
        : "";
      return `<circle cx="${cx}" cy="${cy}" r="22" fill="${t.chalk}" stroke="${t.graphite}" stroke-width="1.6"/>
${icon(stage.icon, cx - 12, cy - 12, 24, t.graphite)}
<text x="${cx}" y="${cy + 40}" text-anchor="middle" font-family="${DISPLAY}" font-size="15" font-weight="800" fill="${t.graphite}">${stage.name}</text>
<text x="${cx}" y="${cy + 55}" text-anchor="middle" font-family="${MONO}" font-size="10" fill="${t.slate}">${stage.note}</text>
${tracks}${human}`;
    })
    .join("\n");
  const sendX = x(6);
  const pitchX = x(5);
  // A fall volta por cima da corda, do send à última anchor: por baixo ela cruzaria os rótulos.
  const fall = `<path d="M ${sendX - 12} ${y(6) - 18} C ${sendX - 22} ${y(6) - 78}, ${pitchX + 14} ${y(5) - 84}, ${pitchX + 6} ${y(5) - 28}" fill="none" stroke="${t.crit}" stroke-width="1.6" stroke-dasharray="5 4"/>
<path d="M ${pitchX + 1} ${y(5) - 36} l 5 9 l 5 -9" fill="none" stroke="${t.crit}" stroke-width="1.6"/>
<text x="${(sendX + pitchX) / 2}" y="${y(5) - 78}" text-anchor="middle" font-family="${MONO}" font-size="10" font-weight="600" fill="${t.crit}">fall</text>`;
  return svg(
    960,
    400,
    "Um climb, do survey ao descent: a line é assinada por você, o seal fica escondido do climber e a fall devolve à última anchor",
    t,
    `<text x="40" y="52" font-family="${DISPLAY}" font-size="28" font-weight="800" fill="${t.graphite}">Um climb, do basecamp ao summit</text>
<text x="40" y="76" font-family="${MONO}" font-size="11" fill="${t.slate}">cada etapa é código · o agente só faz a tarefa da vez · ◆ = decisão humana</text>
<path d="${rope}" fill="none" stroke="${t.rope}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
${fall}
${nodes}`,
  );
}

interface Track {
  mineral: Mineral;
  mohs: number;
  command: string;
  when: string[];
  rows: [string, string | false][];
}

/** The four tracks side by side: what each one runs, what the human signs, how much O₂. */
function tracks(t: Tokens): string {
  const list: Track[] = [
    {
      mineral: "talc",
      mohs: 1,
      command: "mohs fix",
      when: ["correção pequena,", "sem plano nem line"],
      rows: [
        ["plano", "o Basecamp"],
        ["line", false],
        ["bolts e seal", false],
        ["inspection", false],
        ["humano", "diff + decisões"],
        ["O₂", "30 mil"],
      ],
    },
    {
      mineral: "fluorite",
      mohs: 4,
      command: "scout escolhe",
      when: ["até 3 arquivos,", "nada sensível"],
      rows: [
        ["plano", "scout"],
        ["line", "curta"],
        ["bolts e seal", false],
        ["inspection", false],
        ["humano", "assina a line"],
        ["O₂", "60 mil"],
      ],
    },
    {
      mineral: "quartz",
      mohs: 7,
      command: "padrão",
      when: ["features comuns,", "uma ou várias routes"],
      rows: [
        ["plano", "scout"],
        ["line", "completa"],
        ["bolts e seal", "sim"],
        ["inspection", "pelo diff"],
        ["humano", "assina a line"],
        ["O₂", "400 mil"],
      ],
    },
    {
      mineral: "diamond",
      mohs: 10,
      command: "área sensível",
      when: ["auth, dados pessoais,", "pagamento, migração"],
      rows: [
        ["plano", "scout"],
        ["line", "completa"],
        ["bolts e seal", "sim, assinados"],
        ["inspection", "todos"],
        ["humano", "line, bolts, entrega"],
        ["O₂", "1,2 milhão"],
      ],
    },
  ];
  const width = 213;
  const cards = list
    .map((track, i) => {
      const x = 40 + i * (width + 9);
      const m = t.minerals[track.mineral];
      const rows = track.rows
        .map(([label, value], r) => {
          const y = 232 + r * 28;
          const shown = value === false ? "—" : value;
          return `<text x="${x + 18}" y="${y}" font-family="${MONO}" font-size="10.5" fill="${t.slate}">${label}</text>
<text x="${x + width - 16}" y="${y}" text-anchor="end" font-family="${BODY}" font-size="12.5" font-weight="${value === false ? 400 : 600}" fill="${value === false ? t.slate : t.graphite}">${shown}</text>
<rect x="${x + 18}" y="${y + 10}" width="${width - 34}" height="1" fill="${t.vein}"/>`;
        })
        .join("\n");
      return `<rect x="${x}" y="96" width="${width}" height="300" rx="6" fill="${t.granite}"/>
<rect x="${x}" y="96" width="${width}" height="6" rx="3" fill="${m.main}"/>
<text x="${x + 18}" y="152" font-family="${DISPLAY}" font-size="44" font-weight="900" fill="${m.main}">${track.mohs}</text>
<text x="${x + 18 + (track.mohs > 9 ? 56 : 30)}" y="140" font-family="${DISPLAY}" font-size="22" font-weight="800" fill="${t.graphite}">${track.mineral}</text>
<text x="${x + 18 + (track.mohs > 9 ? 56 : 30)}" y="156" font-family="${MONO}" font-size="10" fill="${m.main}">${track.command}</text>
${track.when.map((line, l) => `<text x="${x + 18}" y="${184 + l * 17}" font-family="${BODY}" font-size="13" fill="${t.graphite}">${line}</text>`).join("\n")}
${rows}`;
    })
    .join("\n");
  return svg(
    960,
    420,
    "Quatro trilhas na escala de Mohs: talc 1, fluorite 4, quartz 7 e diamond 10, cada uma com mais cerimônia e mais prova",
    t,
    `<text x="40" y="52" font-family="${DISPLAY}" font-size="28" font-weight="800" fill="${t.graphite}">Quatro trilhas, uma régua</text>
<text x="40" y="76" font-family="${MONO}" font-size="11" fill="${t.slate}">a dureza decide quanto rigor o harness aplica · durante o climb ela só sobe</text>
${cards}`,
  );
}

/** Who sees the sealed tests: the belayer writes them, the harness keeps them, the climber only hears the FALL. */
function seal(t: Tokens): string {
  const box = (x: number, y: number, w: number, title: string, lines: string[], iconName: string, color: string, fill = t.granite) =>
    `<rect x="${x}" y="${y}" width="${w}" height="92" rx="6" fill="${fill}" stroke="${t.vein}"/>
${icon(iconName, x + 16, y + 16, 22, color)}
<text x="${x + 48}" y="${y + 33}" font-family="${DISPLAY}" font-size="18" font-weight="800" fill="${t.graphite}">${title}</text>
${lines.map((line, i) => `<text x="${x + 16}" y="${y + 60 + i * 17}" font-family="${BODY}" font-size="12.5" fill="${t.slate}">${esc(line)}</text>`).join("\n")}`;
  const arrow = (d: string, color: string, dashed = false) =>
    `<path d="${d}" fill="none" stroke="${color}" stroke-width="1.8" ${dashed ? 'stroke-dasharray="5 4"' : ""} marker-end="url(#head-${color.slice(1)})"/>`;
  const heads = [t.graphite, t.crit, t.warn, t.rope]
    .map(
      (color) =>
        `<marker id="head-${color.slice(1)}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0 L10 5 L0 10 Z" fill="${color}"/></marker>`,
    )
    .join("");
  return svg(
    960,
    450,
    "O teste que o climber não vê: o belayer escreve os testes, o harness os guarda fora do projeto e roda num checkout separado, e o climber recebe só a FALL",
    t,
    `<defs>${heads}</defs>
<text x="40" y="52" font-family="${DISPLAY}" font-size="28" font-weight="800" fill="${t.graphite}">O teste que o climber não vê</text>
<text x="40" y="76" font-family="${MONO}" font-size="11" fill="${t.slate}">nenhum outro harness pesquisado esconde os testes de quem implementa</text>
<rect x="30" y="98" width="620" height="120" rx="8" fill="none" stroke="${t.minerals.quartz.main}" stroke-dasharray="4 4"/>
<text x="46" y="118" font-family="${MONO}" font-size="10" font-weight="600" fill="${t.minerals.quartz.main}">FORA DO ALCANCE DO CLIMBER</text>
${box(46, 124, 280, "Belayer", ["escreve os testes da line num", "checkout descartável; todos vermelhos"], "selo", t.minerals.quartz.main)}
${box(356, 124, 280, "Seal guardado", ["~/.mohs/seals, fora do projeto", "e de qualquer worktree"], "selo", t.graphite)}
${box(46, 290, 280, "Climber", ["implementa no worktree da route;", "o Basecamp faz o commit"], "tracado", t.rope, t.chalk)}
${box(636, 290, 284, "Send", ["checkout separado: código da", "route + testes selados, pelo harness"], "cadena", t.graphite)}
${arrow("M 328 170 L 352 170", t.graphite)}
${arrow("M 636 200 C 700 214, 760 250, 770 286", t.graphite)}
${arrow("M 328 336 L 632 336", t.graphite)}
<text x="480" y="328" text-anchor="middle" font-family="${MONO}" font-size="10" fill="${t.slate}">commit da route</text>
${arrow("M 700 384 C 620 410, 300 410, 200 386", t.crit, true)}
<text x="450" y="432" text-anchor="middle" font-family="${MONO}" font-size="10" font-weight="600" fill="${t.crit}">FALL: cenário, esperado, obtido · sem o teste (leak guard)</text>
${arrow("M 150 288 L 150 220", t.warn, true)}
<text x="160" y="258" font-family="${MONO}" font-size="10" font-weight="600" fill="${t.warn}">dispute: contesta com a line</text>
<text x="160" y="272" font-family="${MONO}" font-size="10" fill="${t.slate}">na 2ª vez, você decide</text>`,
  );
}

const IMAGES: Record<string, (t: Tokens) => string> = { hero, flow, tracks, seal };

for (const [name, draw] of Object.entries(IMAGES)) {
  writeFileSync(`${HERE}${name}-light.svg`, draw(LIGHT));
  writeFileSync(`${HERE}${name}-dark.svg`, draw(DARK));
}
console.log(`imagens do README geradas em ${HERE}`);
