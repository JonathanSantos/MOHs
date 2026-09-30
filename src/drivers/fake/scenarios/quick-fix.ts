import type { Scenario } from "./types.ts";

/** A single fluorite route with one pitch: no seal, no inspection, no descent. */
export const quickFix: Scenario = {
  name: "quick-fix",
  description: "Uma route fluorite de um pitch, sem seal nem inspection.",
  request: "Corrigir texto do botão Exportar",
  kind: "variation",
  reason: "mudança de texto em um arquivo",
  survey: { files: 214, summary: "", languages: ["TypeScript", "TSX"], tests: 38 },
  line: '# Line · Texto do botão Exportar\n\nQUANDO a pessoa vê a barra do canvas ENTÃO o botão diz "Exportar PNG".\n',
  routes: [
    {
      id: "A",
      name: "Texto do botão",
      hardness: "fluorite",
      files: ["web/src/features/export/ExportButton.tsx"],
      tags: ["ui"],
      pitches: [
        { title: "Trocar o texto", files: ["web/src/features/export/ExportButton.tsx"], ms: 1500, o2: 9_000, summary: "texto trocado" },
      ],
    },
  ],
  proposals: [],
};
