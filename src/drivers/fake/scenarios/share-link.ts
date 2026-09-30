import type { Scenario } from "./types.ts";

const LINE = `# Line · Compartilhar protótipo por link

## Problema
Hoje um protótipo do editor só pode ser visto por quem tem o projeto aberto. Quem desenha precisa mandar prints.

## Capacidades
1. Gerar um link público, somente leitura, para o protótipo atual.
2. Abrir o link em uma aba anônima e ver o protótipo renderizado.
3. Exportar a tela atual em PNG.
4. Contar quantas vezes cada link foi aberto.

## Restrições
- O token do link não pode ser adivinhado.
- O link expira em 30 dias.
- A exportação mantém a largura lógica da tela, independentemente do zoom.

## Fora do escopo
- Edição colaborativa.
- Links com senha.

## Cenários
- QUANDO a pessoa clica em Compartilhar ENTÃO recebe um link /s/<token> copiado para a área de transferência.
- QUANDO alguém abre /s/<token> válido ENTÃO vê o protótipo sem o editor.
- QUANDO alguém abre /s/<token> expirado ENTÃO vê a mensagem "Este link expirou".
- QUANDO a pessoa exporta com zoom 200% ENTÃO o PNG tem 1440 px de largura.
- QUANDO um link é aberto ENTÃO /api/stats soma uma visualização.

## Sinal de sucesso
Designers param de mandar prints no canal do time.
`;

/** Three routes on a fictional prototype editor: diamond with a security block, quartz with a fall, fluorite straight to the summit. */
export const shareLink: Scenario = {
  name: "share-link",
  description:
    "Três routes num editor de protótipos fictício: diamond com bloqueio de segurança, quartz com uma fall e fluorite direto ao summit.",
  request: "Compartilhar protótipo por link",
  kind: "variation",
  reason: "links públicos são área sensível; rotas novas no server e componentes React",
  survey: {
    files: 214,
    languages: ["TypeScript", "TSX"],
    tests: 38,
    summary:
      "Workspaces web (React + Vite + zustand + react-query) e server (Fastify). Unit com vitest no web; e2e com Playwright em e2e/, tag @rapido para a suíte curta.",
  },
  line: LINE,
  decisions: [
    {
      question: "O que alguém vê ao abrir o link de um protótipo que foi apagado?",
      options: [
        { choice: 'a mensagem "Este protótipo não existe mais"', why: "diz o que aconteceu, como a mensagem do link expirado" },
        { choice: "a página 404 genérica do site", why: "não conta a um estranho que o protótipo existiu" },
      ],
    },
    {
      question: "Quem pode desativar um link antes de ele expirar?",
      options: [
        { choice: "quem criou o link", why: "é quem sabe para quem mandou" },
        { choice: "qualquer editor do projeto", why: "resolve quando quem criou não está por perto" },
        { choice: "ninguém: o link só expira", why: "o pedido fala só em expirar em 30 dias" },
      ],
    },
  ],
  routes: [
    {
      id: "A",
      name: "Link público de compartilhamento",
      hardness: "diamond",
      files: ["server/src/share/token.ts", "server/src/routes/share.ts", "web/src/features/share/ShareButton.tsx"],
      tags: ["api", "auth", "ui"],
      pitches: [
        {
          title: "Token de compartilhamento",
          files: ["server/src/share/token.ts"],
          ms: 2600,
          o2: 92_000,
          summary: "createShareToken e verifyShareToken com expiração de 30 dias",
        },
        {
          title: "Rota POST /api/share",
          files: ["server/src/routes/share.ts"],
          ms: 2600,
          o2: 118_000,
          summary: "rota criada, responde { url } com status 201",
        },
        {
          title: "Rota GET /s/:token",
          files: ["server/src/routes/share.ts", "server/src/render/viewer.ts"],
          crux: true,
          ms: 3200,
          o2: 164_000,
          summary: "viewer somente leitura e página de link expirado",
          rock: { command: "npm run dev:server", error: "porta 3001 ocupada" },
        },
        {
          title: "Botão Compartilhar",
          files: ["web/src/features/share/ShareButton.tsx"],
          ms: 2600,
          o2: 101_000,
          summary: "botão copia o link e mostra confirmação",
        },
      ],
      seal: {
        unit: 22,
        e2e: 5,
        code: "it('expira depois de 30 dias', () => { const token = createShareToken(protoId, { now }); expect(verifyShareToken(token, { now: now + THIRTY_DAYS + 1 })).toEqual({ ok: false, reason: 'expired' }) })",
      },
      inspections: [
        {
          security: [
            {
              severity: "high",
              area: "security",
              text: "Token do link gerado com Math.random, previsível",
              file: "server/src/share/token.ts",
              line: 12,
              confidence: 92,
            },
          ],
          architecture: [
            {
              severity: "medium",
              area: "architecture",
              text: "Renderização do viewer fora de server/src/render",
              file: "server/src/routes/share.ts",
              line: 40,
              confidence: 84,
            },
          ],
          ui: [
            {
              severity: "low",
              area: "ui",
              text: "Confirmação de cópia some rápido demais para leitor de tela",
              file: "web/src/features/share/ShareButton.tsx",
              line: 28,
              confidence: 71,
            },
          ],
        },
        {},
      ],
    },
    {
      id: "B",
      name: "Exportar tela em PNG",
      hardness: "quartz",
      files: ["web/src/features/export/exportPng.ts", "web/src/features/export/ExportButton.tsx"],
      tags: ["ui"],
      pitches: [
        {
          title: "Função exportPng",
          files: ["web/src/features/export/exportPng.ts"],
          ms: 2800,
          o2: 70_000,
          summary: "exportPng usa html-to-image com o nó do canvas",
        },
        {
          title: "Botão Exportar",
          files: ["web/src/features/export/ExportButton.tsx"],
          ms: 2800,
          o2: 64_000,
          summary: "botão na barra do canvas com estado de carregando",
          friction: [{ kind: "brake.denied", detail: "climber B tentou ler e2e/.sealed/ e o brake negou" }],
        },
        {
          title: "Nome do arquivo exportado",
          files: ["web/src/features/export/exportPng.ts"],
          ms: 2200,
          o2: 41_000,
          summary: "arquivo sai como <protótipo>-<data>.png",
        },
      ],
      seal: {
        unit: 14,
        e2e: 3,
        code: "test('@rapido exporta com zoom 200% mantendo a largura lógica', async ({ page }) => { await page.getByTestId('zoom-200').click(); const png = await exportCurrentScreen(page); expect(png.width).toBe(1440) })",
      },
      sendFails: [
        [
          {
            test: "export.spec.ts › exporta com zoom 200%",
            scenario: "exportar com zoom 200%",
            expected: "largura 1440 px",
            actual: "largura 2880 px",
          },
        ],
      ],
      leakyFall: true,
      inspections: [
        {
          ui: [
            {
              severity: "medium",
              area: "ui",
              text: "Exportação trava a tela por 1,2 s sem indicador de progresso",
              file: "web/src/features/export/ExportButton.tsx",
              line: 19,
              confidence: 86,
            },
            {
              severity: "low",
              area: "ui",
              text: "Botão Exportar sem atalho de teclado",
              file: "web/src/features/export/ExportButton.tsx",
              line: 7,
              confidence: 82,
            },
          ],
        },
      ],
    },
    {
      id: "C",
      name: "Contador de uso em /api/stats",
      hardness: "fluorite",
      files: ["server/src/routes/stats.ts"],
      tags: ["api"],
      pitches: [
        {
          title: "Contador em memória exposto em /api/stats",
          files: ["server/src/routes/stats.ts"],
          ms: 4400,
          o2: 38_000,
          summary: "contador por token com Map; GET /api/stats devolve { views }",
        },
      ],
    },
  ],
  proposals: [
    {
      id: "b-01",
      kind: "skill",
      target: "rack/share-tokens/SKILL.md",
      summary: "Gerar tokens públicos com crypto.randomBytes(32) e base64url; nunca Math.random.",
      evidence: ["inspection.report · route A · security · high"],
    },
    {
      id: "b-02",
      kind: "beta",
      target: "beta/portas-de-dev.md",
      summary: "O server de dev usa a porta 3001; a anchor precisa liberar a porta antes de subir.",
      evidence: ["friction env · route A · pitch 3"],
    },
  ],
};
