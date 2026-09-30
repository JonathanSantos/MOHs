# MOHs · My Own Harness System

Harness leve em TypeScript/Node que conduz agentes de código (Claude Sonnet 5.5, Kimi k2.7-code e afins) do pedido à entrega, com testes escondidos do implementador, gates verificados por código, consumo de tokens contado e um painel em tempo real.

Identidade visual e vocabulário: [`identidade.html`](identidade.html). Pesquisa que embasa as decisões: [`../reports/Frameworks agênticos para o MOH.md`](../reports/Frameworks%20agênticos%20para%20o%20MOH.md).

---

## 1. Princípios

1. **O Basecamp é código.** Uma state machine em TypeScript conduz o fluxo. O LLM só entra onde há julgamento (escrever, implementar, revisar, classificar). Agentes nunca decidem o próximo passo do fluxo.
2. **Tudo é evento.** Um log append-only (`events.jsonl`) é a fonte da verdade. Lookout, métricas, friction e replay são projeções dele. O runtime registra sozinho; agentes só emitem calls.
3. **Quem verifica é o harness.** "Os testes passaram" dito por um agente não vale nada. Só contam recibos emitidos pelo Basecamp depois de rodar os comandos ele mesmo.
4. **Rigor proporcional.** Três hardness (fluorite, quartz, diamond). A hardness só sobe durante o climb.
5. **Alpine style.** O₂ contado por climb e por etapa, pack mínimo por agente, código antes do modelo.
6. **Aberto nas bordas, fechado no núcleo.** Rack, beta, inspectors e guidebooks adicionam comportamento. Nenhuma extensão afrouxa o brake.
7. **Agnóstico a quem executa.** O Basecamp publica tarefas e recebe respostas tipadas. Quem faz o trabalho (Claude Code, Copilot, um subagente, o loop próprio por API) é um driver; o núcleo não conhece provedor de modelo nem SDK.

---

## 2. Léxico

| Nome                         | O que é                                                                               | Termo comum             |
| ---------------------------- | ------------------------------------------------------------------------------------- | ----------------------- |
| **Climb**                    | Um pedido, do início ao fim                                                           | run                     |
| **Scout**                    | Lê pedido e repositório, escolhe hardness                                             | triagem                 |
| **First ascent / Variation** | Projeto novo / código existente                                                       | greenfield / brownfield |
| **Survey**                   | Mapa do código existente, feito por código                                            | repo map                |
| **Line**                     | A spec, assinada pelo humano (hash)                                                   | spec                    |
| **Bolts**                    | Contrato de interface                                                                 | contrato                |
| **Seal**                     | Suíte de testes escrita antes e escondida do climber                                  | testes ocultos          |
| **Route**                    | Uma feature, com worktree próprio                                                     | feature                 |
| **Pitch**                    | Uma task, em contexto novo                                                            | task                    |
| **Anchor**                   | Checagem ao fim do pitch + commit de proteção                                         | checkpoint              |
| **Crux**                     | O pitch mais difícil da route; recebe o modelo mais forte                             | task crítica            |
| **Window**                   | Routes que sobem em paralelo (sem arquivos em comum)                                  | wave                    |
| **Send**                     | Os testes selados rodam contra a route pronta                                         | quality gate            |
| **Fall**                     | O send falhou; climber volta à última anchor                                          | gate fail               |
| **Rescue**                   | O Basecamp para e chama o humano                                                      | escalonamento           |
| **Inspection / Report**      | Revisão paralela / arquivo de achados                                                 | review / findings       |
| **Summit**                   | Entrega                                                                               | entrega                 |
| **Descent**                  | Retrospectiva que propõe beta, skills e ajustes                                       | retrospectiva           |
| **Basecamp**                 | A state machine (código)                                                              | orquestrador            |
| **Setter**                   | Escreve line e bolts                                                                  | refinador               |
| **Belayer**                  | Escreve o seal e explica as falls                                                     | autor dos testes        |
| **Climber**                  | Implementa os pitches                                                                 | implementador           |
| **Inspectors**               | Segurança, arquitetura, UI e os que você criar                                        | reviewers               |
| **Scribe**                   | Conduz o descent                                                                      | agente de retrospectiva |
| **Rack**                     | Skills que um papel pode levar                                                        | skills do agente        |
| **Pack**                     | O que o Basecamp monta para uma chamada específica                                    | context pack            |
| **Beta**                     | Conhecimento do projeto escrito pelo dev ou aprovado no descent                       | arquivos-base           |
| **Guidebook**                | Pacote de configuração que um projeto estende                                         | preset                  |
| **Hardness**                 | Fluorite (4), Quartz (7), Diamond (10)                                                | trilha                  |
| **Brake**                    | Motor de política + hooks                                                             | policy engine           |
| **O₂**                       | Orçamento de tokens                                                                   | token budget            |
| **Friction**                 | Tudo que atrasou ou falhou, por tipo                                                  | fricção                 |
| **Calls**                    | Protocolo de mensagens entre agentes                                                  | mailbox                 |
| **Lookout**                  | Painel em tempo real                                                                  | dashboard               |
| **Gym**                      | Routes conhecidas para medir o harness                                                | evals                   |
| **Croqui**                   | Retrato curto e assinado do projeto: intenção, entidades, áreas sensíveis, armadilhas | project context         |

No código, eventos usam os mesmos nomes: `scout.hardness`, `line.signed`, `pitch.anchor`, `send.fall`, `route.summit`.

---

## 3. Fluxo e estados

```
Survey → Scout → Line ✍ → [Bolts] → [Seal] → Pitches⟳Anchor → [Send ⟲ Fall] → [Inspection] → Summit → [Descent]
                   ↑ humano assina                                 ↑ 3 falls → Rescue
```

**Climb:** `surveying → scouting → lining → awaiting_signature → climbing → integrating → descending → done`, com `rescue` (pausado aguardando humano) e `aborted` alcançáveis de qualquer estado.

**Route:** `planned → bolting → sealing → pitching → sending → fallen → inspecting → blocked → summited`. Bolts e seal são de cada route: uma route fluorite vai direto de `planned` a `pitching`. Uma route acima de fluorite começa a subir assim que os bolts estão fixos e as routes de que ela parte estão na entrega: o seal é escrito enquanto ela sobe (o climber nunca o vê, e ele só roda no send), e só o send espera por ele. No climb solo, os testes vêm antes da subida (TDD).

**Pitch:** `ready → climbing → safe → anchored | failed`.

Regras de transição (verificadas pelo Basecamp, não pelo agente):

- `awaiting_signature → climbing` só com assinatura cujo hash bate com o conteúdo atual da line.
- Os pontos que o pedido não decide chegam como **decisões** (`decisions` na resposta do setter, ou do scout com a line fluorite): a pergunta e de 2 a 3 respostas, a recomendada primeiro, cada uma com o porquê. Uma recomendada que contraria o pedido traz o trecho em `against`, e o humano vê o aviso. Ele assina com as recomendadas ou escolhe outra, inclusive com as próprias palavras (`mohs sign D1=B "D2=…"`, ou no Lookout); a line assinada (`line.decided`) fica só com o que foi decidido, e é ela que o crew lê.
- O send de uma route só roda com o seal pronto, e o seal só fica pronto se **todos** os testes selados falham contra o código de antes da route (`seal.red`).
- `safe → anchored` só se os comandos de anchor passam, rodados pelo harness.
- `sending → inspecting` só com recibo de send limpo. Fall incrementa contador; no limite, `rescue`.
- `inspecting → summited` só se nenhum achado atinge a política `block` do brake.
- Qualquer mudança em arquivo selado exige transição explícita aprovada (humano ou belayer com justificativa registrada).

---

## 4. Hardness

|            | Talc (1) · `mohs fix`                                                                             | Fluorite (4)                                      | Quartz (7) · padrão                     | Diamond (10)                                                            |
| ---------- | ------------------------------------------------------------------------------------------------- | ------------------------------------------------- | --------------------------------------- | ----------------------------------------------------------------------- |
| Quando     | correção pequena pedida assim, sem scout                                                          | um erro aparece logo e não quebra nada que existe | um erro custa caro ou demora a aparecer | auth, dados pessoais, pagamentos, migrações, links públicos, > 3 routes |
| Plano      | o Basecamp, por regra: 1 route, 1 pitch                                                           | scout                                             | scout                                   | scout                                                                   |
| Line       | — (o climber lista as decisões no `safe`)                                                         | curta, escrita pelo scout ou setter               | completa, assinada                      | completa, assinada                                                      |
| Bolts      | —                                                                                                 | —                                                 | sim                                     | sim, assinados                                                          |
| Seal       | —                                                                                                 | —                                                 | unit + e2e                              | unit + e2e                                                              |
| Send       | —                                                                                                 | —                                                 | seal                                    | seal + suíte completa do projeto                                        |
| Inspection | —                                                                                                 | —                                                 | só inspectors acionados pelo diff       | todos, em modelo diferente do climber                                   |
| Limites    | ≤ 3 arquivos e 120 linhas de código, nada sensível (`talc:` no `mohs.yaml`); passou disso, escala | —                                                 | —                                       | —                                                                       |
| Summit     | assinado: diff + decisões do climber                                                              | automático                                        | automático                              | assinado                                                                |
| Descent    | —                                                                                                 | —                                                 | sim                                     | sim                                                                     |
| O₂ padrão  | 30k                                                                                               | 60k                                               | 400k                                    | 1,2M                                                                    |

O Scout propõe entre fluorite, quartz e diamond; `--hardness` força. Talc só existe quando alguém pede (`mohs fix`): depois que um scout planejou, a cerimônia já foi paga. Durante o climb a hardness só sobe (`scout.escalated`); um talc que sobe vira outro climb (`climb.escalated` e `mohs climb --from <id>`).

Todo summit diz o que o provou (`evidence` no `route.summit`): **forte** com testes selados e testes do projeto, **média** com um dos dois, **fraca** só com build, lint ou checks, **nenhuma** sem nada. Um comando de teste num projeto sem arquivos de teste conta como checagem sem teste.

---

## 5. Seal e Send: a barreira

- O belayer escreve os testes num **checkout descartável** do código atual e responde com os caminhos. O runner copia os arquivos para `~/.mohs/seals/<projeto>/<climb>/<route>/`, fora do projeto e de qualquer worktree, e apaga o checkout.
- `seal.red`: cada arquivo selado roda contra o código atual, num checkout limpo, com `commands.seal` (`{file}` é o caminho; `seal_e2e` para e2e). Arquivo que já passa volta ao belayer com o motivo; na segunda vez, um humano decide.
- O send leva seal + último commit da route para outro checkout descartável e roda cada arquivo; em diamond, também a suíte completa (`commands.send`). O belayer recebe a saída crua; o climber recebe só a call `FALL` (cenário, esperado, obtido), já passada pelo leak guard. Nenhum arquivo selado entra no worktree nem na branch do climber.
- O climber pode escrever testes próprios (visíveis). Eles rodam na anchor, mas não decidem o send.
- Leak guard: o Basecamp compara cada `FALL` com o código do seal (sobreposição de n-gramas) e pede ao belayer que reescreva; se ainda vazar, o cenário é redigido.
- Com agentes externos, o sigilo depende também de contexto: a skill manda orquestrar um subagente por papel, e o belayer nunca passa testes nem saída ao climber. Os hooks negam a leitura de `~/.mohs/seals`.
- **Climb solo** (`mohs climb --solo`), para um agente que não pode criar subagentes: um segredo que o próprio autor conhece não prova nada, então os testes não são selados, são **travados**. A tarefa de testes vem antes da subida (TDD), com o mesmo `seal.red`; o Basecamp guarda a cópia e a roda no send, e o climber a lê no pack (seção "Testes da route"). Mudar os testes no worktree não muda o que roda; discordar de um teste é `dispute`. Uma falha vai crua ao climber, sem FALL do belayer nem leak guard, e a evidência diz "testes travados". A separação de papéis por nome não vale no solo.
- Sem `commands.seal`, cada arquivo selado roda pela extensão, com o runtime da stack e sem dependência: `.js/.mjs/.cjs/.ts/.mts/.cts` com `node --test`, `.py` com `python3`, `.sh` com `sh`; passa quem sai com 0. O belayer sabe disso pela tarefa e tem de volta um arquivo que nenhum runner roda. Só num projeto de outra stack (Go, Rust, Java…) sem `commands.seal` o climb quartz ou diamond para logo depois do scout.

---

## 6. Calls

Mensagens tipadas, validadas por schema. Prosa só onde humano lê.

| Call    | De → para           | Campos                                                                  |
| ------- | ------------------- | ----------------------------------------------------------------------- |
| `CLIMB` | basecamp → climber  | route, pitch, pack                                                      |
| `SAFE`  | climber → basecamp  | route, pitch, summary (≤ 280)                                           |
| `FALL`  | belayer → climber   | scenario, expected, actual                                              |
| `WATCH` | climber → basecamp  | excerpt, question (line ambígua; canal formal para não contornar teste) |
| `ROCK`  | qualquer → basecamp | command, error (ambiente)                                               |
| `TAKE`  | basecamp → humano   | reason, options (rescue)                                                |

---

## 7. Integração, brake e hooks

### 7.1 Tarefas e drivers

O Basecamp não chama modelo nenhum. Cada papel vira uma **tarefa**: o pack (dividido em `brief`, estável e cacheável, e `assignment`, o que muda), onde trabalhar, se é só leitura, os arquivos previstos, os comandos que o Basecamp vai rodar depois e as respostas que a encerram (`plan`, `line`, `safe`, `watch`, `rock`, cada uma com schema zod). A `TaskCrew` monta as tarefas; um **task board** decide quem as faz:

| Driver           | Board       | Quem trabalha                                                                       |
| ---------------- | ----------- | ----------------------------------------------------------------------------------- |
| `agent` (padrão) | `FileBoard` | um agente de código (Claude Code, Copilot, um subagente) pela CLI                   |
| `api`            | `ApiBoard`  | o loop próprio do MOHs, com o SDK da Anthropic ou provedores compatíveis com OpenAI |
| `fake`           | —           | a equipe simulada por cenário, para demo e testes do fluxo                          |

O núcleo nunca importa `src/drivers/` (um teste de arquitetura garante); só a CLI conhece todos os drivers. Uma integração nova é um driver novo, sem tocar no Basecamp.

### 7.2 A CLI do agente

O `FileBoard` grava cada tarefa em `.mohs/climbs/<id>/tasks/T<n>.json`. O agente conversa com o Basecamp por três comandos:

- `mohs climb "<pedido>" --detach` sobe o Basecamp em segundo plano e já imprime o primeiro passo.
- `mohs next` diz o que o climb precisa agora: a tarefa aberta, a vez do humano (assinar a line, responder um rescue), o fim ou que o Basecamp está trabalhando (espera até `--wait` segundos). Sem `--role`, várias tarefas abertas (ou uma de belayer) viram um quadro: uma linha por tarefa, com o comando do agente daquele papel. A tarefa de belayer só aparece por inteiro com `--role belayer` ou `--task`, e um nome (`--as`) que já pegou tarefa de belayer não pega de climber, nem o contrário.
- `mohs call <resposta>` valida a resposta contra o schema antes de entregar, espera o Basecamp processar (anchor, commit) e imprime o passo seguinte. Uma anchor que falha volta como nova tentativa, com a saída do comando.

`mohs line` mostra a line gravada (o agente não lê `.mohs/`). A saída de `mohs call` confirma o que foi aceito e conta o que o Basecamp fez com a resposta (checagens, commit, drift) antes do próximo passo. O `safe` aceita `notes`: o que o climber viu fora do escopo e não mudou vira friction `crew.note`, matéria-prima do descent.

Todo comando impresso roda do jeito que está (inclui `--cwd` quando o agente trabalha num worktree). As instruções para o agente ficam em `core/agent/SKILL.md` (`mohs agent` mostra), no formato de skill do Claude Code e do Copilot.

### 7.3 Brake e hooks

A mesma ideia do brake de ferramentas do loop próprio vale para agentes que o MOHs não roda. `mohs agent install claude` (ou `copilot`) põe a skill onde o agente a encontra e registra três hooks, que chamam `mohs hook <evento> --for <plataforma>`:

| Hook           | Faz                                                                                                                                                                                       |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PreToolUse`   | nega sempre a leitura de `~/.mohs/seals`; durante um climb, nega `.mohs/` e `.env`, `git commit`/`checkout`/`reset` e afins, e escrita fora do diretório de uma tarefa aberta que escreve |
| `Stop`         | não deixa o agente parar com uma tarefa aberta ou com o Basecamp trabalhando; libera na vez do humano e no fim; no máximo 3 bloqueios por tarefa                                          |
| `SessionStart` | numa sessão nova, diz em uma linha que há um climb em andamento e onde ele está                                                                                                           |

A política é uma função pura (`src/hooks/policy.ts`) sobre a situação do climb; o comando só traduz o JSON de cada plataforma. O Claude Code lê a decisão em `hookSpecificOutput`, o Copilot no topo; por isso o instalador passa `--for`. Os caminhos são comparados pelo caminho real (links simbólicos). Um hook que quebra libera a ação, de propósito: no Copilot, um `preToolUse` que falha nega todas as ferramentas. `MOHS_DEBUG=1` mostra o erro. Fora de um climb, só o seal é protegido.

O que vale para qualquer driver continua no Basecamp, lido do git: arquivos fora do pitch viram `scope.drift` a partir do commit da anchor, e as checagens são sempre rodadas pelo harness.

`brake.yaml` (política de severidade, simples de propósito):

```yaml
block: [critical, high]
warn: [medium]
ignore: [low]
min_confidence: 80
falls_before_rescue: 3
```

**Pisos que nenhuma configuração ou extensão remove:** `critical` sempre bloqueia; seal sempre negado ao climber; diamond sempre tem seal, bolts assinados e todos os inspectors; `falls_before_rescue` ≤ 5.

---

## 8. O₂ e Pack

O **pack** é montado pelo Basecamp para cada chamada, sempre na mesma ordem (prefixo estável para cache de prompt):

1. instrução-núcleo do papel
2. regras da hardness
3. skills do rack que casaram (ordem alfabética)
4. beta que casou
5. fatia do survey
6. bolts
7. trecho da line relevante ao pitch
8. o pitch em si + última `FALL`/`WATCH`, se houver

Regras: contexto novo por pitch; handoff por arquivo; pitch cabe em 20–30% da janela; do log de teste só a asserção que falhou; cada etapa com cota de O₂; estourou → o Basecamp decide (subir hardness ou rescue), o agente nunca segue sozinho.

---

## 9. Extensões: Rack, Beta, Inspectors, Checks e Guidebooks

O objetivo: quem usa o MOHs customiza os pontos centrais só criando arquivos, e o climber passa a implementar do jeito do time.

### 9.1 Os pontos de extensão

| Ponto             | Onde                         | Formato                                   | Para quê                                                                        |
| ----------------- | ---------------------------- | ----------------------------------------- | ------------------------------------------------------------------------------- |
| **Rack** (skills) | `.mohs/rack/<nome>/SKILL.md` | Markdown + frontmatter                    | Procedimentos: "como criamos um componente", "como escrevemos uma rota Fastify" |
| **Beta**          | `.mohs/beta/*.md`            | Markdown + frontmatter                    | Fatos do projeto: onde fica o SDK Y, convenções que divergem do padrão          |
| **Inspectors**    | `.mohs/inspectors/*.md`      | Markdown + frontmatter (rubrica)          | Novos revisores: acessibilidade, performance, i18n                              |
| **Checks**        | `.mohs/checks/*.ts`          | TypeScript (`defineCheck`)                | Gates determinísticos próprios: tamanho de bundle, build do Storybook           |
| **Config**        | `.mohs/mohs.yaml`            | YAML                                      | Comandos, modelos por papel, cotas de O₂, rack fixo por papel                   |
| **Brake**         | `.mohs/brake.yaml`           | YAML                                      | O que bloqueia                                                                  |
| **Guidebooks**    | `extends:` no `mohs.yaml`    | pasta ou pacote npm com a mesma estrutura | Reusar tudo isso entre projetos e times                                         |

Os inspectors e presets que vêm com o MOHs usam exatamente esses formatos. O núcleo não tem caminho privilegiado.

### 9.2 Uma skill no rack do climber

```markdown
---
name: react-component
description: Como criamos componentes React neste projeto
roles: [climber] # quem pode levar (padrão: climber)
when:
  files: ["web/src/**/*.tsx"] # entra no pack quando o pitch toca esses arquivos
  hardness: [quartz, diamond] # opcional
load: match # always | match | index
---

- Um componente por pasta: `Nome/index.tsx` + `Nome.test.tsx`.
- Estado global só via store zustand; nada de Context novo.
- Dados remotos sempre com react-query, nunca fetch no componente.
```

O formato é o mesmo `SKILL.md` do Claude Code e do Copilot. Os campos `roles`, `when` e `load` são opcionais. Uma skill sem eles fica no índice do rack e o agente pode pedi-la por nome.

`load`:

- `always`: sempre no pack desse papel.
- `match` (padrão quando há `when`): o **Basecamp** decide por regra (arquivos do pitch, hardness, tags da line). O modelo não precisa lembrar de buscar.
- `index`: só nome e descrição entram; o corpo é carregado se o agente pedir.

### 9.3 Configuração

```yaml
# .mohs/mohs.yaml
extends:
  - mohs:react # guidebook oficial
  - mohs:fastify
  - ../team-guidebook # pasta do time

commands:
  anchor: [npm run typecheck, npm run test:quick]
  send: [npm run test:full]
  dev: npm run dev

models:
  setter: claude-sonnet-5-5
  belayer: claude-sonnet-5-5
  climber: kimi-k2.7-code
  crux: claude-sonnet-5-5

rack:
  climber:
    always: [react-component]
    exclude: [legacy-redux] # desliga uma skill herdada
    o2: 8k # teto de skills no pack
  sources: [.claude/skills] # reaproveita skills que você já tem

hardness:
  quartz: { o2: 500k }
```

### 9.4 Um check em TypeScript

```ts
// .mohs/checks/bundle-size.ts
import { defineCheck } from "mohs";

export default defineCheck({
  name: "bundle-size",
  at: "send", // anchor | send | summit
  when: { files: ["web/**"] },
  async run({ exec }) {
    const { stdout } = await exec("npm run build -w web -- --json");
    const kb = JSON.parse(stdout).sizeKb;
    return kb < 350 ? { ok: true } : { ok: false, severity: "high", message: `bundle com ${kb} KB (limite 350)` };
  },
});
```

Node 24 roda o arquivo `.ts` direto. O resultado entra no report como qualquer achado e passa pelo brake.

### 9.5 Cascata e merge

Ordem, da mais fraca para a mais forte:

1. núcleo do MOHs
2. guidebooks em `extends` (na ordem da lista)
3. `~/.mohs/` (preferências do usuário)
4. `.mohs/` do projeto
5. flags do climb (`--rack +nome`, `--hardness diamond`)

Regras: objetos YAML fazem merge profundo; listas substituem; arquivo com o mesmo `name` substitui o anterior; `exclude` remove itens herdados. Nada disso passa por cima dos pisos do brake (seção 7).

### 9.6 Visibilidade

- `mohs doctor`: valida tudo com schema e aponta arquivo e linha do erro.
- `mohs rack climber --files web/src/App.tsx --hardness quartz`: mostra exatamente o que entraria no pack e quanto O₂ custa.
- No Lookout, cada chamada mostra as skills e o beta que foram no pack.
- Se as skills casadas passam da cota, o Basecamp prioriza (mais específica primeiro) e registra friction `pack.overflow`.

### 9.7 Descent escreve nas bordas

O descent só roda quando o climb teve atrito além das anotações do climber (`crew.note`): um climb que subiu sem nenhum tropeço não tem o que ensinar, e o scribe custaria um agente para propor o que ninguém pediu. O scribe só propõe mudanças em superfícies de extensão: `rack/`, `beta/`, `inspectors/` e ajustes em `mohs.yaml` dentro dos pisos. Cada proposta é um diff com evidência citada (eventos, falls, reports). O humano escolhe; o que entra vale a partir do próximo climb. Núcleo, seal, checks e `brake.yaml` nunca são alterados pelo scribe.

---

## 10. Estruturas de pasta

### Repositório do MOHs

```
mohs/
├─ src/
│  ├─ cli.ts              # ponto de entrada
│  ├─ index.ts            # API pública (defineCheck)
│  ├─ domain/             # linguagem do MOHs: tipos, catálogo de eventos, calls, estados, plano
│  ├─ config/             # camadas, extends, merge, schemas, política do brake, itens do rack
│  ├─ rack/               # seleção de skills, beta e inspectors por regra (when)
│  ├─ pack/               # montagem do pack com ordem fixa e O₂ contado
│  ├─ brake/              # política de achados e judgeToolUse (brake de ferramentas)
│  ├─ guards/             # leak guard
│  ├─ view/               # projeção dos eventos: reducer com registry de handlers + timeline
│  ├─ basecamp/           # sessão, journal, stages (pipeline), RouteClimber, HumanGate, event log, presença
│  ├─ crew/               # contratos: Crew, Runner, CrewError, CrewDriver
│  ├─ tasks/              # tarefas e respostas, TaskCrew, FileBoard, situação do climb, driver agent
│  ├─ runner/             # LocalRunner (worktrees, anchor, commits) e shell portátil
│  ├─ survey/ workspace/  # mapa do projeto sem LLM; git e worktrees
│  ├─ drivers/            # a camada de cima: o núcleo nunca importa daqui
│  │  ├─ api/             # loop próprio, tools, provedores (Anthropic SDK, OpenAI-compatible), ApiBoard
│  │  └─ fake/            # equipe simulada e cenários
│  ├─ lookout/            # servidor (hub, auth, comandos, assets) e front em módulos ES
│  ├─ cli/                # comandos (padrão Command), registry de drivers, relatórios, scaffold do init
│  └─ util/               # fs, glob, paths, frontmatter, O₂, runtime, zod em português
├─ core/                  # camada núcleo: mohs.yaml, brake.yaml, roles/, inspectors/, agent/SKILL.md
├─ guidebooks/            # react, fastify, playwright
├─ gym/                   # projeto de demonstração e, na fase 5, as routes de avaliação
└─ test/
```

### No projeto alvo

```
.mohs/
├─ mohs.yaml
├─ brake.yaml
├─ rack/<skill>/SKILL.md
├─ beta/*.md
├─ inspectors/*.md
├─ checks/*.ts
├─ git/             # git-dir privado quando o projeto não usa git
└─ climbs/<id>/     # events.jsonl, trace.jsonl, line, tasks/, bolts, seal, basecamp.json e .log (gitignored)
```

Git é dependência interna: se o projeto já é repositório, o MOHs usa `git worktree` nele; se não é, mantém um git-dir privado em `.mohs/git` com a pasta do projeto como work-tree. Uma route = um worktree.

---

## 11. Stack e convenções de código

- Node 24 com type stripping nativo (sem build). Só sintaxe apagável: sem `enum`, sem `namespace`, sem parameter properties, imports com `.ts`.
- Dependências: `zod`, `yaml`, `ws`. O SDK da Anthropic e o cliente compatível com OpenAI (`fetch`, para o Kimi) vivem só em `drivers/api`.
- Testes: `node:test`. Formatação: Prettier (140 colunas). `npm run check` roda typecheck, formatação e testes; o CI roda isso em Linux, macOS e Windows.
- Lookout: página estática servida pelo mesmo processo; WebSocket nos dois sentidos. Sessão com chave e checagem de `Origin`.

**Idioma.** Identificadores, nomes de teste e mensagens para desenvolvedor (erros internos) em inglês. Texto que o usuário lê (CLI, Lookout, diagnósticos, friction) em português. Comentários em português só onde explicam uma decisão que o código não conta sozinho.

**Padrões usados, e onde:**

| Padrão                                          | Onde                                                                                | Por quê                                                                               |
| ----------------------------------------------- | ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| Catálogo tipado de eventos (união discriminada) | `domain/events.ts`                                                                  | quem grava, quem projeta e quem exibe falam o mesmo contrato, checado pelo compilador |
| Registry no lugar de `switch`                   | handlers do reducer, timeline, linhas da CLI, resumo das calls, comandos do Lookout | cada evento novo é uma entrada nova, não mais um `case` num arquivo que só cresce     |
| Pipeline de stages (Strategy)                   | `basecamp/stages/`                                                                  | uma cerimônia nova é um `Stage` novo; o Basecamp não muda                             |
| Command                                         | `cli/commands/`                                                                     | ajuda e parser de flags gerados da mesma declaração                                   |
| Strategy por tipo de item                       | `config/items.ts`                                                                   | skill, beta e inspector diferem em pasta, schema e padrões, não em código             |
| Exceção de controle                             | `RouteAbandoned`, `ClimbAborted`                                                    | abandono atravessa vários níveis sem espalhar `boolean` de retorno                    |
| Fila serializada                                | `HumanGate.rescue`                                                                  | duas routes pedindo ajuda ao mesmo tempo nunca intercalam perguntas                   |
| Ports and adapters                              | `crew/` (portas), `drivers/` e `tasks/agent-driver.ts` (adaptadores)                | o núcleo não sabe quem executa; trocar de agente ou de provedor não toca no Basecamp  |
| Strategy (task board)                           | `FileBoard`, `ApiBoard`                                                             | a mesma tarefa vai para um agente pela CLI ou para o loop próprio                     |

**Portabilidade (Windows, macOS, Linux).** Caminhos sempre por `node:path` (`join`, `resolve`, `isAbsolute`); globs e caminhos de arquivo comparados com `/` depois de normalizar; ids de climb sem `:`; usuário atual por `os.userInfo()`; finais de linha LF garantidos por `.gitattributes` e `.editorconfig`. Na fase 2, comandos de anchor e send rodam com `shell: true` para que `npm` resolva `npm.cmd` no Windows.

---

## 12. Como testamos o MOHs

1. **Unit do núcleo:** transições da state machine, cascata de config, matching do rack, montagem do pack dentro da cota, decisões do brake.
2. **Climb inteiro com a equipe simulada** (e, na fase 2, com FakeProvider): respostas roteirizadas, sem custo, em CI. Inclui caos: JSON inválido, tool proibida, agente em loop, três falls seguidas, skill que estoura a cota.
3. **Leak test:** nenhum trecho do seal aparece em prompt do climber (todo pack fica no log).
4. **Protocolo do agente, de ponta a ponta:** o teste roda a CLI de verdade (`next`, `call`, `sign`, `--detach`) contra um Basecamp com `FileBoard` e worktrees reais.
5. **Subagente no ginásio:** um subagente (Sonnet) recebe só a skill do MOHs e um pedido, e conduz um climb num projeto de ginásio usando apenas o que a CLI mostra. O relato de atrito dele vira correção no harness.
6. **Validações com braços** (`docs/VALIDATION.md`): o mesmo pedido feito sem harness, com placebo e com o MOHs (talc, completo, sem subagentes), cada braço num subagente e numa pasta de `.validation/`, julgados pela mesma suíte escondida. `npm run validate` cria, registra o uso e avalia.
7. **Gym num projeto real:** mesmas tarefas em quatro braços (Claude Code ou Copilot puro, MOHs sem inspection, MOHs completo, placebo), ≥ 5 repetições, julgados por uma suíte de aceite retida só do gym. Métricas: taxa de aprovação, O₂, tempo, minutos humanos, linhas de markdown geradas, falls, achados confirmados.

---

## 13. Roadmap

| Fase                                                         | Entrega                                                                                                                                                                                                                                                                                                                                                                                                                         | Pronto quando                                                                                                                          |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| **0 · Base** ✅                                              | Este documento, identidade em `docs/`, `package.json`, estrutura de pastas                                                                                                                                                                                                                                                                                                                                                      | `npm test` roda                                                                                                                        |
| **1 · Basecamp + config + Lookout** ✅                       | events JSONL, state machine, loader com cascata/extends + `mohs doctor`, rack + pack (determinísticos), equipe simulada (FakeCrew), Lookout mostrando um climb simulado                                                                                                                                                                                                                                                         | um climb simulado completo aparece no Lookout; `mohs rack` mostra o pack certo                                                         |
| **2 · Agentes + Brake + Fluorite** ✅                        | providers reais (Anthropic SDK, OpenAI-compatible), loop de agente, tools com brake, survey sem LLM, worktrees git, LocalRunner                                                                                                                                                                                                                                                                                                 | um climb fluorite chega ao summit numa branch própria (testado com modelo roteirizado; falta a rodada com credencial num projeto real) |
| **3 · Harness agnóstico + CLI** ✅                           | tarefas com respostas tipadas, TaskCrew, drivers (`agent`, `api`, `fake`), `mohs next`/`call`/`agent`, `--detach`, drift lido do commit                                                                                                                                                                                                                                                                                         | um subagente conduz um climb fluorite só pela CLI                                                                                      |
| **4 · Quartz** ✅                                            | bolts, seal em checkout descartável guardado fora do projeto, `seal.red`, send em checkout separado, FALL do belayer com leak guard, inspectors e scribe como tarefas                                                                                                                                                                                                                                                           | route quartz com fall e recuperação, conduzida por subagentes um por papel                                                             |
| **5 · Diamond + hooks + descent aplicado** ✅                | assinatura dos bolts e do summit, checks em TS rodando, `mohs beta accept`/`reject`, hooks do Claude Code e do Copilot (`PreToolUse`, `Stop`, `SessionStart`) com `mohs agent install`                                                                                                                                                                                                                                          | um climb diamond pede assinatura dos bolts e da entrega; uma proposta do scribe vira skill com um comando                              |
| **5.1 · Entrega integrada + relatório** ✅                   | `after` nas routes, janelas por dependência, branch de entrega com merge por janela e checagem final, conflito e falha viram tarefa de climber, posse de tarefa (`--as`), pack sem seções repetidas, `mohs report`                                                                                                                                                                                                              | um pedido de três partes dependentes sai numa entrega que passa na suíte escondida sem merge manual                                    |
| **5.2 · Rigging por route + packs enxutos** ✅               | bolts e seal dentro do caminho de cada route, route espera só as dependências e quem divide arquivos com ela, diff numerado para inspectors (testes só para quem declara `tests: true`), quadro no `mohs next` sem papel, separação belayer/climber por nome, limites da resposta no topo da tarefa                                                                                                                             | uma route fluorite sobe enquanto o belayer de outra route ainda escreve testes                                                         |
| **5.3 · Talc, evidência e projetos sem testes** ✅           | trilha talc (`mohs fix`: sem scout nem line, limites checados no diff, `escalate`, assinatura no fim), `mohs climb --from`, grau de evidência em todo summit, seal sem `commands.seal` por extensão, scout escreve a line em fluorite                                                                                                                                                                                           | uma correção pequena custa uma tarefa de agente; um projeto Node ou Python sem runner configurado faz quartz                           |
| **5.4 · Plano de testes, contestação, retomada e croqui** ✅ | `mohs init --tests` com recomendação por stack, teto de casos por cenário no seal, `dispute`/`uphold` com o humano na segunda contestação, `mohs climb --resume` adotando worktrees, seal guardado e tarefas abertas, `mohs croqui`                                                                                                                                                                                             | um climb retomado depois de o Basecamp morrer termina sem refazer bolts, seal nem pitches prontos                                      |
| **5.5 · Orquestração enxuta** ✅                             | seal em paralelo com a subida (o send espera), climb solo com testes travados (TDD), agentes por papel com só as ferramentas do papel (`mohs agent install`), planejador único para scout e setter, quadro para várias tarefas do mesmo papel, `call` que espera o próximo passo do mesmo agente, descent só com atrito, decisões da line com opções e escolha na assinatura, scout pelo custo do erro, talc contando só código | o climber não espera o belayer; um agente sem subagentes faz TDD com testes que não pode afrouxar                                      |
| **6 · Gym**                                                  | suíte de avaliação num projeto real com os quatro braços                                                                                                                                                                                                                                                                                                                                                                        | primeiro relatório comparativo                                                                                                         |

---

### Notas da fase 1

- **Hardness por route.** O Scout propõe uma hardness para cada route; a do climb é a maior delas. Bolts, seal e inspection seguem a hardness da route, então uma route fluorite dentro de um climb diamond não paga cerimônia à toa. O cilindro de O₂ é a soma dos cilindros das routes.
- **Equipe simulada no lugar de FakeProvider.** A fase 1 simula os papéis (`FakeCrew`) e os comandos (`FakeRunner`), não o modelo. O FakeProvider, no nível do LLM, entra com o loop de agente na fase 2.
- **Assinatura dos bolts em diamond** fica para a fase 3, junto com o setter real. A assinatura da line já funciona pela CLI e pelo Lookout, presa ao hash.
- **Publicação.** O Node não remove tipos de arquivos dentro de `node_modules`; publicar o pacote vai exigir um passo de build. Até lá, `node src/cli.ts`.

### Notas da fase 2

- **Survey primeiro, sempre.** Custa zero O₂ e decide first ascent ou variation por regra (arquivos de código presentes ou não). O scout já planeja olhando o mapa real.
- **Loop de agente próprio, append-only.** A resposta do modelo volta intacta no turno seguinte (o Sonnet 5.5 recusa histórico editado). O agente termina chamando uma ferramenta de término (`plan`, `line`, `safe`, `watch`, `rock`), sem `tool_choice` forçado, que dá 400 nos modelos atuais.
- **Cache de prompt em duas marcas:** o pack estável vai no `system` e o fim do histórico usa cache automático. Leitura de cache conta 10% no O₂.
- **Fallback de recusa ligado por padrão** na Anthropic (`fallbacks: "default"`); desligável com `agents.fallbacks: false`.
- **Brake de ferramentas:** caminhos fora do workspace, `.git`, `.mohs` e `.env` são negados; `node_modules` e lockfiles são somente leitura; comandos só por correspondência exata com a anchor e `tools.commands`. Escrever fora dos arquivos do pitch é permitido e vira friction `scope.drift`.
- **Telemetria separada:** cada chamada de ferramenta vai para `trace.jsonl`; o `events.jsonl` guarda só eventos estruturais.
- **Worktrees fora do projeto,** em `~/.mohs/worktrees`, para que vitest, tsc e afins do projeto não os varram. `node_modules` entram por junction (sem admin no Windows) e nunca são commitados.
- **A equipe real declara o que sabe fazer** (`supportedHardness`). Se o scout pedir quartz ou diamond, o climb para com a explicação, antes de criar qualquer worktree.

### Notas da fase 3

- **Tarefas são o único contrato com quem executa.** O loop próprio da fase 2 continua, mas como driver (`api`): recebe a mesma tarefa que um agente pela CLI e transforma as respostas em ferramentas de término.
- **O Basecamp continua um processo.** O agente fala com ele por arquivos na pasta do climb (como o desk dos humanos), então funciona igual em qualquer SO e entre processos. `basecamp.json` guarda o pid; se o processo morre, `mohs next` diz que o climb parou em vez de oferecer uma tarefa que ninguém vai recolher.
- **`mohs call` valida antes de entregar e espera o resultado.** O agente recebe o erro do schema na hora (em português) e, depois, o próximo passo na mesma saída: uma chamada por tarefa.
- **O₂ de agentes externos** conta o pack entregue (o que o MOHs controla); o gasto real do agente fica de fora até termos hooks que o reportem.
- **Drift lido do commit.** Arquivos fora do pitch viram `scope.drift` a partir do commit da anchor, para qualquer driver, com ou sem controle das ferramentas.
- **O subagente como banco de prova.** Um subagente Sonnet conduziu um climb fluorite no ginásio só com a skill e a CLI, sem nenhum comando repetido. O relato de atrito dele virou correção: o setter recebia regras de quartz num climb fluorite; fluorite agora tem um único pitch (validado no schema do `plan`); a saída do `call` diz o que a anchor rodou e o commit; `mohs line` para conferir a line; `notes` no `safe`; a tarefa explica o `--cwd`. Numa segunda rodada, com outro pedido e contexto novo, nenhum desses atritos voltou; os novos (premissas do setter, arquivos do commit no retorno da anchor, contador do resumo, exemplos marcados como ilustrativos) também viraram correção.

### Notas da fase 4

- **Todos os papéis do quartz viraram tarefas:** bolts (setter), seal e fall (belayer), report (inspector), beta (scribe). Nada de novo no Basecamp além dos contratos: o `Crew` recebe as notas do climb (survey, line, bolts) e o `Runner` ganhou `prepareSeal`, `sealRed`, `send` e `diff`.
- **Correção de vazamento:** antes, o `fix` depois de uma fall recebia a falha crua do runner. Agora recebe só a FALL do belayer, já passada pelo leak guard.
- **`seal.red` por arquivo.** O runner sabe se um arquivo passou ou falhou pelo código de saída do comando, sem entender cada framework de teste. É mais fraco que por caso de teste (um arquivo com um teste já verde e outro vermelho conta como vermelho) e fica como decisão em aberto.
- **Ajustes do primeiro A/B:** a situação sabe quando a line é assinada automaticamente; o `.mohs` sai do worktree do climber e nunca é commitado; as notas do climber aparecem no fim do climb; a dica do `plan` mostra os limites de tamanho; `mohs call` logo depois de uma decisão humana espera a próxima tarefa; o brake aceita `{file}` num comando permitido.
- **Um subagente por papel.** `mohs next --role <papel>` mostra só as tarefas daquele papel e manda parar quando a aberta é de outro. A skill orienta o agente principal a orquestrar assim.
- **Cada papel no seu contexto.** A saída do `call` mostra a próxima tarefa só se ela é do mesmo papel; qualquer outra é só nomeada, com o `mohs next --role` de quem vai pegá-la. Assim o climber nunca lê uma tarefa de belayer (testes selados, saída crua do send). O furo apareceu no relato do subagente belayer, antes de qualquer climber rodar; o climber confirmou depois que tarefas de outros papéis eram ruído. Quem faz todos os papéis sozinho paga um `mohs next` a cada troca de papel.
- **Validação com subagentes, um por papel.** Um climb quartz ("etiquetas nas tarefas") no ginásio, com o agente principal orquestrando planejador, belayer, climber e revisor, e fazendo o papel de humano. O belayer escreveu 23 testes selados, todos vermelhos no código atual; o climber passou no send de primeira sem ver os testes; o inspector não achou problemas; o scribe propôs 2 betas. A entrega passou nos 4 testes de aceite escondidos, e nenhum arquivo selado chegou à branch. Os relatos viraram correção: tarefas de outro papel só nomeadas, limites dos campos visíveis antes da recusa, regra de quartz do setter separando line e bolts, scribe com o resumo do climber e as extensões existentes.
- **Hardness forçada à vista.** `--hardness` vira um `scout.escalated` com o motivo, e a saída do `call plan` mostra a troca.

### Notas da fase 5

- **Assinaturas genéricas.** Além da line, qualquer coisa pode esperar a assinatura humana (`signature.requested` / `signature.given`, presas a um hash). Em diamond, os bolts de cada route são assinados antes do seal, e a entrega é assinada presa ao último commit da route. `mohs sign [alvo]` e o Lookout assinam o que estiver pendente.
- **Checks em TypeScript rodam.** `at: "anchor"` roda com os comandos da anchor, antes do commit, pelo `Runner`; `send` e `summit` entram na inspection como um inspector determinístico, também em fluorite. O Basecamp carrega os checks no começo do climb e para se algum arquivo estiver quebrado; `mohs doctor` mostra antes.
- **Descent aplicado.** `mohs beta` lista as propostas do scribe; `accept` escreve a skill, o beta ou o inspector em `.mohs/`, com frontmatter válido e a evidência num comentário, e registra a escolha no log; mudanças de `mohs.yaml` são mostradas para aplicar à mão.
- **Hooks para dois agentes.** Um adaptador, dois dialetos. O formato veio da documentação oficial de cada plataforma (conferida em 29/09/2026) e os testes rodam o comando de verdade com esses payloads. Ainda falta uma rodada com Claude Code e Copilot instalados de fato.
- **Inspectors em outro modelo, em diamond,** ficam como orientação: no driver `agent`, um subagente que não implementou; no `api`, `models.inspector` diferente de `models.climber`. Nada impede ainda a mesma escolha.

### Notas da fase 5.1

- **Dependências no plano.** Uma route pode ter `after: [ids]`. As janelas respeitam essa ordem, e uma route que depende de outra começa do código dela: cada route que chega ao summit entra por merge na branch de entrega (`mohs/<climb>/entrega`), e as janelas seguintes partem dela.
- **Entrega testada junta.** No fim, os selados de todas as routes, a anchor e a suíte rodam na entrega. Conflito de merge ou falha vira uma tarefa de climber no worktree da entrega. Falha selada passa pelo belayer da route (FALL, leak guard), e falha de comando visível vai como está.
- **Posse de tarefa.** `mohs next --as <nome>` guarda a tarefa para quem pediu (`tasks/T<n>.claim.json`, criado de forma exclusiva). Outro agente vê que ela está com alguém e não a pega. Isso resolveu os climbers duplicados do primeiro teste grande.
- **Pack sem repetição.** Seções que o agente já recebeu (survey, papel, line, bolts) voltam só com o hash. `--full` mostra tudo.
- **`mohs report`.** Um index.html autocontido a partir do log: linha do tempo por agente, plano em janelas, decisões filtráveis por papel, line, entrega, O₂ e atrito. Nunca traz conteúdo de tarefa nem de teste selado.
- **Validação.** O mesmo pedido de três partes das duas rodadas (`gym/api-02`). Na primeira (5.0), as duas routes paralelas passaram em 0/5 e 1/5 na suíte escondida, e 5/5 só com merge manual. Na segunda (5.1), o plano saiu com A antes de B e C, a entrega passou em 5/5 sem intervenção, com 0 conflitos, 0 falls e checagem final 14/14 na 1ª tentativa. Os gargalos vistos viraram a fase 5.2.

### Notas da fase 5.2

Correções que vieram do teste grande da 5.1 (`gym/api-02`):

- **Rigging por route.** A etapa de rigging do climb inteiro virou parte do caminho de cada route (`Ascent`): bolts de todas as routes em paralelo, o seal de uma route espera os bolts dela e das dependências (os testes usam essas interfaces), e a subida espera só as routes das quais ela parte, ou seja, dependências e routes de uma janela anterior que dividem arquivos com ela (`blockersOf`). As janelas continuam como a ordem planejada (`ascent.planned`); uma route pronta que espera outra registra `route.waiting`. Cada route entra na entrega quando chega ao summit, um merge por vez. No teste da 5.1, a route fluorite teria começado 36 minutos antes.
- **Diff para revisão.** O inspector recebe o diff com o número de cada linha no arquivo, então cita `arquivo:linha` sem procurar. Arquivos de teste (por nome ou pasta) só entram para inspectors com `tests: true` no frontmatter (o de arquitetura); para os outros eles aparecem numa linha, com o tamanho. No diff da route C do teste, o pack de segurança cai de 49 KB para 16 KB.
- **Sigilo no `mohs next`.** Sem `--role`, a CLI não mostra tarefa de belayer nem escolhe entre várias abertas: mostra o quadro. A separação belayer/climber vale por nome (`--as`), com as tarefas que o nome já pegou no climb.
- **Limites antes do trabalho.** Os limites de tamanho da resposta principal vêm no cabeçalho da tarefa, antes do pack.

### Notas da fase 5.3

Vieram dos dois cenários em que o MOHs não se pagava: correções pequenas e projetos sem testes. Nos logs do A/B, o código do harness gastava cerca de 2 s por tarefa; scout e setter, 20 a 26 s; e a assinatura da line ficava no caminho antes do trabalho.

- **Talc.** `mohs fix "<pedido>"` (ou `--hardness talc`) pula scout e line: o Basecamp planeja uma route com um pitch por regra, e a primeira tarefa já é do climber, com o pedido inteiro. O climber termina com `safe` (e `decisions`: o que o pedido não deixou claro) ou `escalate`. O Basecamp confere o diff contra os limites de `talc:` (arquivos, linhas, globs sensíveis; testes não contam) e escala sozinho se passar. O summit é assinado com o diff e as decisões juntos: um portão humano, no fim. Um climb escalado termina em `escalated`, e `mohs climb --from <id>` recomeça com o mesmo pedido e o motivo.
- **Plano e line numa tarefa.** Num climb só de fluorite, o scout pode mandar a line com o plano (`line` no `plan`); o setter não roda.
- **Seal sem configuração.** Runners embutidos por extensão (`src/runner/seal-runners.ts`), `mohs init` sugerindo `node --test {file}` ou `python3 {file}` quando o projeto não tem runner, e `riggingProblem` olhando as linguagens do survey. O runner também tira `NODE_TEST_CONTEXT` do ambiente dos comandos do projeto, para um `node --test` não se reportar a um runner pai.
- **Grau de evidência.** Calculado no summit a partir do seal, dos comandos da anchor (e da suíte em diamond), dos arquivos de teste do projeto (o survey agora os conta) e dos checks. Aparece na CLI, no fim do climb (com aviso quando é fraca ou nenhuma), no Lookout e no relatório.

### Notas da fase 5.4

- **Plano de testes no `init`.** Um registro por stack (`src/cli/scaffold/test-plan.ts`) decide, sem LLM, o que o seal roda agora (o runner do projeto ou o da linguagem) e o que é recomendado (vitest + Testing Library num projeto React, pytest em Python, Playwright para e2e web), com o comando de instalação. `mohs init --tests <opção>` escolhe; o `doctor` mostra o plano. O MOHs nunca instala dependência: instalar um runner é uma mudança como outra qualquer.
- **Teto do belayer.** `hardness.<nível>.tests_per_scenario` (quartz 3, diamond 5) vezes os cenários da route na line (a seção dela, quando a line agrupa por route; o setter é orientado a agrupar). Os casos são contados pela forma como cada linguagem os declara. A primeira resposta acima do teto volta com o motivo; a segunda passa e vira friction `seal.oversized`. No teste da 5.1, a route C teria 80 casos de teto contra os 131 escritos.
- **Contestação do seal.** Depois de uma FALL, o climber pode responder `dispute` com o trecho da line. O belayer, num checkout com os arquivos selados, responde `uphold` (passado pelo leak guard) ou corrige os arquivos. Uma segunda contestação vai a um humano: `retry` mantém o teste, `proceed` obriga o belayer a corrigir. Teste selado só muda por esse caminho (`seal.disputed`, `seal.upheld`, `seal.amended`).
- **Retomada.** `mohs climb --resume <id>` lê o log (`resumePoint`) e refaz só o que falta: survey em silêncio, plano e line do log, bolts e seal já prontos pulados (o seal volta de `~/.mohs/seals`, com um manifesto dos tipos), cada route a partir do primeiro pitch sem anchor, routes no summit apenas integradas. O runner adota as branches e worktrees que existem; o quadro de tarefas adota as que ficaram abertas, com o mesmo id e o mesmo agente. O evento `climb.resumed` volta ao começo o que estava em andamento.
- **Croqui.** `mohs croqui` é um climb de uma tarefa de scout: o JSON tipado (`.mohs/croqui.json`, com `.md` para leitura) traz propósito, entidades, áreas sensíveis, armadilhas e até 6 seções livres, cada item citando arquivos. Citação que não existe ou área sensível que não casa com nada volta ao scout. O humano assina; o hash de cada arquivo citado fica guardado, e o que mudou depois aparece como "pode estar desatualizado". Scout e setter leem o croqui inteiro; os outros papéis, só o que fica perto dos seus arquivos. As áreas sensíveis somam aos limites do talc. Falta lapidar: quando redesenhar, como o scribe propõe atualizações e se ele se paga (medir no ginásio, num projeto grande).

### Notas da fase 5.5

- **De onde veio.** A validação `mini-jquery-simples` mostrou o climber parado 5 minutos esperando o belayer, com o seal que ele nunca vê e que só roda no send; e cada subagente começando com cerca de 50 mil tokens de contexto, quase tudo ferramentas da sessão que o papel não usa (um agente com quatro ferramentas começa com cerca de 26 mil). O MOHs em si manda pouco: a skill tem cerca de 1,3 mil tokens e cada tarefa de 1 a 4 mil.
- **Seal em paralelo.** Depois dos bolts, o Ascent prepara o worktree do climber, abre a tarefa do belayer e logo a do climber: as duas aparecem juntas no quadro, na mesma ordem sempre. O send espera o seal (`route.waiting` com `seal`); um seal que termina o climb (rescue `abort`) o termina na hora. O `seal.started` só vira o estado de uma route que ainda não subiu. Um checkout de seal que sobrou de um Basecamp morto é descartado ao retomar.
- **O `call` espera o próximo passo do mesmo agente.** Com tarefas de outros abertas, a saída do `call` voltava antes de a próxima tarefa do mesmo agente abrir (a anchor ainda rodando, o seal sendo conferido), e o agente parava. Agora, enquanto o Basecamp trabalha na route dele para aquele papel, tarefas que já estavam abertas não contam.
- **Agentes por papel.** `mohs agent install` grava `mohs-planner`, `mohs-belayer`, `mohs-climber`, `mohs-inspector` e `mohs-scribe` (`.claude/agents/`, `.github/agents/`), cada um com as ferramentas do papel e as regras da skill. O planejador faz scout e setter com o mesmo nome; um climber pode subir uma route depois da outra. O repositório do MOHs versiona os seus (`npm run validate -- agents`), porque os braços de uma validação são subagentes da sessão que a roda; o Claude Code os carrega ao abrir a sessão.
- **Solo.** O agente decide no começo: com subagentes, `mohs climb`; sem, `mohs climb --solo`. O Basecamp não enxerga o que o agente pode fazer, então a escolha fica na skill. A comparação `mohs` × `mohs-solo` numa validação mede o valor do sigilo contra o de testes só travados.
- **Descent só com atrito**, e **quadro para várias tarefas do mesmo papel** (dois inspectors em paralelo pegavam a tarefa um do outro).
- **Decisões com opções.** Na mesma validação, a revisão cega (entregas anônimas, rubrica fixa) pôs os braços MOHs atrás em correção: o setter decidiu contra o "mesmo comportamento do jQuery" do pedido, a assinatura passou sem leitura e o seal garantiu o erro. As decisões agora são estruturadas, com a recomendada primeiro, o aviso de `against` e a escolha do humano na assinatura; o crew só lê o que foi decidido.
- **Scout pelo custo do erro.** A regra "quartz para features comuns, na dúvida a maior" punha uma biblioteca nova de 180 linhas em quartz. Agora a hardness mede quanto custa um erro que passe e quando alguém o vê; um pedido grande e de baixo risco vira várias routes fluorite.
- **Talc conta só código.** Testes e documentação (`*.md`, `docs/`) ficam fora do limite de arquivos e de linhas, e o climber lê a regra assim.

### Notas da fase 5.6: monorepo e solo lapidado

- **De onde veio.** Um braço mohs-solo (Sonnet) corrigindo a issue #28713 do React: hook dentro de `do/while` não era acusado pela `rules-of-hooks`. A suíte escondida foi o arquivo de testes da correção que o React fez depois; a primeira correção real (#28714) quebrou casos válidos.
- **Dependências de monorepo.** O worktree ligava o `node_modules` da raiz inteiro, onde o yarn liga cada pacote do workspace ao código da raiz: os testes do worktree carregavam o código antigo. Agora `node_modules` com links de volta ao projeto vira uma pasta de verdade, com os pacotes do workspace apontando para a cópia do checkout, e o de cada pacote do workspace é ligado também (`linkDependencies`). A validação usa a mesma função.
- **`init` em monorepo.** A anchor vira `npm test -- {packages}`: o runner troca `{packages}` pelos pacotes do workspace que o pitch tocou (sem pacote tocado, nada a rodar). Lint e testes da raiz inteira ficam fora. Um `npm test` que é um script próprio (`node ./scripts/jest/jest-cli.js`) faz do seal `npm test -- {file}`.
- **Decisões do climber em qualquer trilha.** A escolha que a line não decide vai em `decisions` no `safe`, somando os pitches; uma route com decisões pede a assinatura do humano no summit, com elas na tela. No React, a escolha "somar o erro de loop ao condicional" passou sem ninguém ver e custou 2 testes.
- **Solo lapidado.** A tarefa de testes manda espelhar os casos que a suíte já cobre nos construtos parecidos (no React, os testes de `while` já tinham hook na condição e `return` dentro do loop: os dois casos que o braço perdeu), e o belayer de qualquer climb faz o mesmo. O inspector do solo sabe que escreveu o código e começa pelos casos que nenhum teste cobre.
- **Contexto e isolamento.** Os braços seguem as convenções do projeto da pasta (o `CLAUDE.md` do MOHs chegava a eles e o climber escreveu comentários em português no React) e mantêm rascunhos numa pasta temporária do sistema; a skill diz o mesmo.

### Notas da fase 5.7: cerimônia por intenção, reproducer e o gym de issues

- **Intenção do pedido.** O scout diz se o pedido é fix, feature, refactor ou new (`intent`, no plano e no log), e cada um traz as suas checagens (`src/domain/ceremony.ts`), além das da hardness. A hardness mede quanto custa um erro; a intenção diz que prova cabe na mudança.
- **Reproducer (fix).** Antes da line, um papel novo escreve num checkout descartável um teste que falha hoje pelo motivo do bug; o Basecamp confere que falha (senão volta, e na segunda um humano decide). O setter planeja com ele, o climber da route A o vê no pack, o send da route o roda (mesmo em fluorite) e, no summit, ele entra no projeto como teste de regressão. A evidência conta "teste de reprodução (falhava antes, passa agora)". No talc, o climber pode declarar os seus testes de reprodução no `safe`; o Basecamp confere que falham na base e passam agora.
- **Refatoração.** Um teste que existia na base e foi modificado, renomeado ou apagado faz a anchor voltar ao climber: os testes antigos são a prova de que nada mudou por fora.
- **Setter.** Decisões com `when` viram cenários QUANDO/ENTÃO na line assinada (o belayer as testa, o teto as conta); em geral até 3; uma referência externa do pedido guia a recomendada; uma regra geral do pedido que esbarra no próprio pedido vira decisão com as duas leituras.
- **Solo mais curto.** O scout do solo manda a line com o plano em qualquer hardness (sem tarefa de setter) e, fora do diamond, não há bolts: a line descreve a interface. Um quartz solo vai do plano assinado direto aos testes.
- **Monorepo.** `{filters}` além de `{packages}` (pnpm e turbo), workspaces do `pnpm-workspace.yaml`, guidebook `mohs:monorepo` ligado pelo `init`; o climber compara o comportamento antes e depois quando muda algo que existe.
- **Gym de issues reais** (`gym/issues`, `validate issue`): 5 issues do plugin de hooks do React, cada uma com a suíte escondida conferida (falha na base, passa na referência).

## 14. Decisões em aberto

- `seal.red` por caso de teste, e não por arquivo: exige ler o relatório de cada framework (TAP do node:test, JSON do vitest e do jest). Os guidebooks podem trazer esse leitor.
- `SubagentStop`: hoje só o agente principal é segurado pelo hook de Stop. Um subagente de papel pode parar no meio da tarefa dele.
- Em quartz, dizer quais cenários da line cada pitch cobre: hoje o climber vê a line inteira e decide o recorte pelo título do pitch.

- Guidebooks oficiais iniciais: `react`, `fastify`, `playwright` são suficientes para um projeto React + Fastify real?
- Checks em TypeScript entram na fase 4 ou antes?
- Nomes em inglês: validar depois de uma semana de uso real da CLI.
