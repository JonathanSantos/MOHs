import type { ProjectProfile } from "./detect.ts";

const yamlList = (items: readonly string[]) => `[${items.map((item) => JSON.stringify(item)).join(", ")}]`;

/** Files created by `mohs init`, keyed by path inside `.mohs/`. */
export function scaffoldFiles(profile: ProjectProfile): Record<string, string> {
  return {
    "mohs.yaml": mohsYaml(profile),
    "brake.yaml": BRAKE_YAML,
    ".gitignore": "climbs/\ngit/\n",
    "rack/README.md": RACK_README,
    "beta/README.md": BETA_README,
    "inspectors/README.md": INSPECTORS_README,
    "checks/README.md": CHECKS_README,
  };
}

function mohsYaml(profile: ProjectProfile): string {
  return `# Configuração do MOHs para este projeto.
# Camadas, da mais fraca para a mais forte: núcleo → guidebooks (extends) → ~/.mohs → este arquivo → flags.

extends: ${yamlList(profile.guidebooks)}

# Comandos que o harness executa. O agente nunca diz que passou: quem roda é o Basecamp.
commands:
  anchor: ${yamlList(profile.anchor)}   # ao fim de cada pitch
  send: ${yamlList(profile.send)}       # suíte completa, só em diamond, junto com os testes selados
${sealLines(profile)}${profile.dev ? `  dev: ${profile.dev}\n` : ""}
# Modelo por papel. Sem prefixo = Anthropic; outros provedores usam "provedor/modelo".
# O crux é o pitch mais difícil de cada route.
models:
  scout: claude-sonnet-5-5
  setter: claude-sonnet-5-5
  climber: claude-sonnet-5-5     # ex.: moonshot/kimi-k2.7-code (exige MOONSHOT_API_KEY)
  crux: claude-sonnet-5-5

# Loop de agente: turnos e teto de O₂ por tarefa, effort (Anthropic).
agents:
  max_turns: 40
  effort: medium
  max_o2_per_task: 300k

# Comandos que o climber pode rodar além dos da anchor (correspondência exata).
tools:
  commands: []

# Skills que cada papel leva. As skills ficam em .mohs/rack/<nome>/SKILL.md.
rack:
  climber:
    always: []
    exclude: []
    o2: 8k
  # sources: [.claude/skills]   # reaproveita skills do Claude Code ou do Copilot

# Cilindro de O₂ por hardness.
hardness:
  talc: { o2: 30k }
  fluorite: { o2: 60k }
  quartz: { o2: 400k }
  diamond: { o2: 1.2M }
`;
}

/** How one sealed test file runs; without it, quartz and diamond stop before the line is written. */
function sealLines(profile: ProjectProfile): string {
  const unit = profile.seal
    ? `  seal: ${JSON.stringify(profile.seal)}   # roda um arquivo de teste selado; {file} é o caminho\n`
    : `  # seal: "go test {file}"   # como rodar um arquivo de teste; sem isto, só .js/.ts (node --test), .py (python3) e .sh rodam\n`;
  return profile.sealE2e ? `${unit}  seal_e2e: ${JSON.stringify(profile.sealE2e)}\n` : unit;
}

const BRAKE_YAML = `# O que bloqueia uma route depois da inspection. critical sempre bloqueia.
block: [critical, high]
warn: [medium]
ignore: [low]
min_confidence: 80
falls_before_rescue: 3
`;

const RACK_README = `# Rack

Uma pasta por skill: \`rack/<nome>/SKILL.md\`. Mesmo formato das skills do Claude Code e do Copilot.

\`\`\`markdown
---
name: react-component
description: Como criamos componentes React neste projeto
roles: [climber]
when:
  files: ["web/src/**/*.tsx"]
---
- Um componente por pasta, com o teste ao lado.
\`\`\`

Veja o que entraria no pack: \`mohs rack climber --files web/src/App.tsx\`.
`;

const BETA_README = `# Beta

Fatos do projeto que o código não conta sozinho: onde fica um SDK, convenções que fogem do padrão, armadilhas conhecidas.
Um arquivo \`.md\` por assunto. Sem \`when\`, entra no pack de todos os papéis, então seja breve.
`;

const INSPECTORS_README = `# Inspectors

Um arquivo \`.md\` por inspector, com a rubrica no corpo. Use o mesmo nome de um inspector do núcleo
(security, architecture, ui) para substituí-lo.

\`\`\`markdown
---
name: accessibility
description: Acessibilidade dos componentes alterados
when:
  files: ["web/src/**/*.tsx"]
---
- Todo controle tem rótulo acessível.
\`\`\`
`;

const CHECKS_README = `# Checks

Gates determinísticos em TypeScript: um arquivo por check, com \`export default defineCheck({...})\`.
Quem roda é o Basecamp, no worktree da route; o agente nunca diz que passou.

- \`at: "anchor"\`: junto com os comandos da anchor, antes do commit. Falhou, o pitch volta para o climber.
- \`at: "send"\` (depois de um send limpo) e \`at: "summit"\` (antes do summit, em qualquer hardness): a falha vira
  um achado com a severidade que você der (high, se não disser), e o brake decide se bloqueia.

\`\`\`ts
import { defineCheck } from "mohs";

export default defineCheck({
  name: "sem-console",
  at: "anchor",
  when: { files: ["src/**"] },
  async run({ exec }) {
    const { code } = await exec("git grep -q console.log -- src");
    return code === 0 ? { ok: false, message: "tire o console.log de src/" } : { ok: true };
  },
});
\`\`\`

\`mohs doctor\` carrega cada check e aponta o que estiver quebrado antes de um climb.
`;
