import { SCOUT_HARDNESS, SEVERITIES } from "../domain/types.ts";
import { z } from "../util/zod.ts";

/** One structured answer that ends a task. Whoever the agent is, the Basecamp validates it against the schema. */
export interface AnswerSpec<S extends z.ZodType = z.ZodType> {
  description: string;
  schema: S;
  /** The field that plain text fills, for answers given as text or Markdown (`mohs call safe "…"`). */
  textField?: string;
  /** What to write in place of the text, when it fits on one line. */
  placeholder?: string;
  /** A filled-in example, shown to agents that answer through the CLI. */
  example: z.input<S>;
  /** A rule the example alone does not show, printed under it. */
  hint?: string;
  /** One line that confirms what was accepted. */
  summarize(input: z.output<S>): string;
}

function defineAnswer<S extends z.ZodType>(spec: AnswerSpec<S>): AnswerSpec<S> {
  return spec;
}

const pitchSchema = z.strictObject({
  title: z.string().min(3).max(120),
  files: z.array(z.string()).min(1).describe("arquivos que o pitch vai criar ou alterar"),
  crux: z.boolean().optional().describe("true no pitch mais arriscado da route"),
});

const routeSchema = z
  .strictObject({
    id: z.string().regex(/^[A-Z]$/, "use uma letra maiúscula: A, B, C…"),
    name: z.string().min(3).max(80),
    hardness: z.enum(SCOUT_HARDNESS),
    files: z.array(z.string()).min(1),
    tags: z.array(z.string()).describe("ex.: ui, api, auth, data"),
    pitches: z.array(pitchSchema).min(1).max(8),
    after: z
      .array(z.string().regex(/^[A-Z]$/))
      .optional()
      .describe("routes que precisam chegar ao summit antes desta; ela parte do resultado delas"),
  })
  .refine((route) => route.hardness !== "fluorite" || route.pitches.length === 1, {
    message: "fluorite tem um único pitch: junte os passos ou use quartz",
    path: ["pitches"],
  });

function hasCycle(routes: readonly { id: string; after?: string[] }[]): boolean {
  const after = new Map(routes.map((route) => [route.id, route.after ?? []]));
  const state = new Map<string, "visiting" | "done">();
  const visit = (id: string): boolean => {
    if (state.get(id) === "visiting") return true;
    if (state.get(id) === "done") return false;
    state.set(id, "visiting");
    const cyclic = (after.get(id) ?? []).some(visit);
    state.set(id, "done");
    return cyclic;
  };
  return routes.some((route) => visit(route.id));
}

const plural = (n: number, word: string, many = `${word}s`) => `${n} ${n === 1 ? word : many}`;

/** Every answer a task can end with, keyed by the name the agent calls. */
export const ANSWERS = {
  plan: defineAnswer({
    description: "Entrega o plano do climb: routes independentes, cada uma com hardness, arquivos e pitches pequenos.",
    schema: z
      .strictObject({
        reason: z.string().min(3).describe("por que essa hardness, em uma frase"),
        routes: z.array(routeSchema).min(1).max(6),
        line: z.string().min(40).optional().describe("só quando todas as routes são fluorite: a line, e o climb pula o setter"),
      })
      .superRefine(({ routes }, context) => {
        const ids = new Set(routes.map((route) => route.id));
        routes.forEach((route, index) => {
          for (const id of route.after ?? []) {
            if (id === route.id || !ids.has(id)) {
              context.addIssue({
                code: "custom",
                path: ["routes", index, "after"],
                message: `after cita ${id}, que não é outra route do plano`,
              });
            }
          }
        });
        if (hasCycle(routes)) context.addIssue({ code: "custom", path: ["routes"], message: "as dependências (after) formam um ciclo" });
      }),
    example: {
      reason: "troca de texto em um componente, sem área sensível",
      line: '# Line · Saudação curta\n\nQUANDO alguém chama greet() ENTÃO recebe "oi".\n\nFora: traduções.',
      routes: [
        {
          id: "A",
          name: "Saudação curta",
          hardness: "fluorite",
          files: ["src/greet.ts", "src/greet.test.ts"],
          tags: ["ui"],
          pitches: [{ title: "Trocar a saudação e ajustar o teste", files: ["src/greet.ts", "src/greet.test.ts"] }],
        },
      ],
    },
    hint: 'fluorite tem um único pitch. Numa route com vários pitches, marque o mais arriscado com "crux": true. Se uma route usa o que outra cria, declare "after": ["A"]: ela sobe depois e parte do resultado. Routes sem after e sem arquivos em comum sobem em paralelo. Com todas as routes fluorite, mande também "line" (curta: o problema, os cenários QUANDO/ENTÃO e o que fica de fora): o humano assina e o climb pula a tarefa do setter; com quartz ou diamond, deixe a line para o setter.',
    summarize: ({ routes, line }) =>
      routes
        .map(
          (route) =>
            `${route.id} ${route.name} (${route.hardness}, ${plural(route.pitches.length, "pitch")}${route.after?.length ? `, depois de ${route.after.join(", ")}` : ""})`,
        )
        .join("; ") + (line ? " · com a line" : ""),
  }),

  line: defineAnswer({
    description: "Entrega a line (spec) em Markdown, pronta para um humano revisar e assinar.",
    schema: z.strictObject({ text: z.string().min(40) }),
    textField: "text",
    example: { text: '# Line\n\nQUANDO alguém chama greet() ENTÃO recebe "oi".' },
    summarize: ({ text }) => `${plural(text.trim().split("\n").length, "linha")} gravadas; confira com mohs line`,
  }),

  safe: defineAnswer({
    description: "Pitch concluído. Diga o que fez, não que passou: as checagens o Basecamp roda em seguida.",
    schema: z.strictObject({
      summary: z.string().min(3).max(280).describe("o que foi feito, em até 280 caracteres"),
      notes: z.string().max(280).optional().describe("o que você notou fora do escopo e não mudou"),
      decisions: z
        .array(z.string().min(3).max(200))
        .max(8)
        .optional()
        .describe("escolhas que o pedido não deixou claras, para o humano confirmar (talc)"),
    }),
    textField: "summary",
    placeholder: "o que foi feito, até 280 caracteres",
    example: { summary: "greet() agora devolve oi; teste ajustado" },
    hint: 'Notou algo fora do escopo (um bug antigo, um risco) e não mudou? Conte em JSON: {"summary": "…", "notes": "…"}. Numa correção talc, as escolhas que o pedido não deixou claras vão em "decisions": ["…"].',
    summarize: ({ summary, notes, decisions }) =>
      `resumo com ${summary.length}/280 caracteres${notes ? " e uma nota" : ""}${decisions?.length ? ` e ${plural(decisions.length, "decisão", "decisões")}` : ""}`,
  }),

  dispute: defineAnswer({
    description:
      "A FALL pede algo que a line não diz, ou diz o contrário: o belayer confere o teste contra a line e, se vocês discordarem, um humano decide.",
    schema: z.strictObject({
      excerpt: z.string().min(3).max(300).describe("o trecho da line, copiado como está"),
      argument: z.string().min(3).max(400).describe("por que o esperado da FALL contradiz esse trecho"),
    }),
    example: {
      excerpt: "QUANDO o título tem só espaços ENTÃO add lança título vazio",
      argument: "a FALL espera que o título seja aparado e aceito, mas a line manda lançar erro",
    },
    hint: "Use só quando a line sustentar você. Um teste difícil de passar não é um teste errado.",
    summarize: ({ excerpt }) => `contesta a FALL com a line: "${excerpt.slice(0, 60)}"`,
  }),

  uphold: defineAnswer({
    description: "O teste está certo: explique ao climber, em comportamento observável, por que a line pede isso.",
    schema: z.strictObject({ reason: z.string().min(3).max(280).describe("por que a line pede esse comportamento") }),
    textField: "reason",
    placeholder: "por que a line pede esse comportamento",
    example: { reason: "a line diz que o título é aparado antes da checagem; só espaços vira vazio e deve lançar erro" },
    hint: "Não copie o teste nem suas asserções: o leak guard bloqueia.",
    summarize: ({ reason }) => reason,
  }),

  croqui: defineAnswer({
    description:
      "Entrega o croqui do projeto: para que serve, entidades, áreas sensíveis, armadilhas e o que mais ele pedir, tudo citando arquivos.",
    schema: z.strictObject({
      purpose: z.string().min(20).max(500).describe("para que o projeto serve e para quem, em 2 ou 3 frases"),
      entities: z
        .array(z.strictObject({ name: z.string().min(2).max(60), where: z.string().min(1), what: z.string().min(3).max(200) }))
        .max(20),
      sensitive: z.array(z.strictObject({ glob: z.string().min(1), why: z.string().min(3).max(160) })).max(12),
      pitfalls: z.array(z.strictObject({ text: z.string().min(3).max(240), file: z.string().min(1) })).max(10),
      sections: z
        .array(z.strictObject({ title: z.string().min(3).max(60), text: z.string().min(10).max(800), files: z.array(z.string()).min(1) }))
        .max(6),
    }),
    example: {
      purpose: "Lista de tarefas para uso pessoal: uma store em memória e uma API HTTP local, sem login.",
      entities: [{ name: "Tarefa", where: "src/tasks.js", what: "id sequencial, título, prioridade, concluída; nunca reaproveita id" }],
      sensitive: [{ glob: "src/server.js", why: "recebe requisições de qualquer página aberta no navegador" }],
      pitfalls: [{ text: "add devolve cópia: mudar o objeto devolvido não muda a store", file: "src/tasks.js" }],
      sections: [],
    },
    hint: "Só o que é caro de tirar do código: intenção, vocabulário, invariantes, áreas sensíveis, armadilhas. A estrutura de pastas o survey já dá. Todo arquivo citado precisa existir, e toda área sensível precisa casar com algum arquivo.",
    summarize: ({ entities, sections }) => `${plural(entities.length, "entidade")} e ${plural(sections.length, "seção", "seções")} livres`,
  }),

  escalate: defineAnswer({
    description: "A correção é maior ou mais delicada do que parece: o climb para e pede o fluxo completo, com plano e line.",
    schema: z.strictObject({ reason: z.string().min(3).max(280).describe("por que não é uma correção pequena") }),
    textField: "reason",
    placeholder: "por que não é uma correção pequena",
    example: { reason: "o bug está no fluxo de login e mexe em 4 arquivos" },
    summarize: ({ reason }) => reason,
  }),

  watch: defineAnswer({
    description: "A line está ambígua ou se contradiz e não dá para seguir sem uma decisão humana.",
    schema: z.strictObject({ excerpt: z.string().describe("trecho da line em dúvida"), question: z.string().min(3) }),
    example: { excerpt: "o link expira", question: "Expira em quanto tempo?" },
    summarize: ({ question }) => question,
  }),

  bolts: defineAnswer({
    description: "Entrega os bolts da route em Markdown: toda interface nova ou alterada, sem detalhe de implementação.",
    schema: z.strictObject({ text: z.string().min(20) }),
    textField: "text",
    example: { text: "# Bolts · route A\n\n```js\nrename(id: number, title: string): Task | null\n```" },
    summarize: ({ text }) => `${plural(text.trim().split("\n").length, "linha")} gravadas`,
  }),

  seal: defineAnswer({
    description: "Entrega os testes selados: os arquivos que você criou no diretório da tarefa, cada um marcado como unit ou e2e.",
    schema: z.strictObject({
      files: z
        .array(
          z.strictObject({
            path: z.string().min(1).describe("relativo ao diretório da tarefa"),
            kind: z.enum(["unit", "e2e", "support"]).describe("support: arquivo auxiliar que os testes importam, nunca rodado sozinho"),
          }),
        )
        .min(1),
      reason: z.string().max(280).optional().describe("o que mudou, quando você corrige um teste contestado"),
    }),
    example: { files: [{ path: "test/sealed/renomear.test.js", kind: "unit" }] },
    hint: 'O Basecamp copia os arquivos, guarda fora do projeto e confere que cada teste falha no código atual. Um helper compartilhado entra com "kind": "support".',
    summarize: ({ files }) => {
      const tests = files.filter((file) => file.kind !== "support").length;
      return `${plural(tests, "arquivo")} de teste selado${tests === 1 ? "" : "s"}${tests < files.length ? ` e ${files.length - tests} de apoio` : ""}`;
    },
  }),

  fall: defineAnswer({
    description: "Explica ao climber o que falhou no send, em termos de comportamento observável.",
    schema: z.strictObject({
      scenario: z.string().min(3).max(200).describe("o cenário da line que falhou"),
      expected: z.string().min(1).max(200),
      actual: z.string().min(1).max(200),
    }),
    example: { scenario: "renomear com título só de espaços", expected: "erro título vazio", actual: "título virou string vazia" },
    hint: "Não copie código, nomes de teste nem asserções do seal: o leak guard bloqueia.",
    summarize: ({ scenario }) => scenario,
  }),

  report: defineAnswer({
    description: "Entrega os achados desta inspection, com severidade e confiança. Sem problema real, a lista vem vazia.",
    schema: z.strictObject({
      findings: z.array(
        z.strictObject({
          severity: z.enum(SEVERITIES),
          area: z.string().min(2).max(60),
          text: z.string().min(3).max(400),
          file: z.string().optional(),
          line: z.number().int().positive().optional(),
          confidence: z.number().int().min(0).max(100),
        }),
      ),
    }),
    example: {
      findings: [
        { severity: "medium", area: "validação", text: "rename aceita id não numérico", file: "src/tasks.js", line: 30, confidence: 70 },
      ],
    },
    hint: 'Nada a apontar? {"findings": []}.',
    summarize: ({ findings }) => (findings.length ? plural(findings.length, "achado") : "nenhum achado"),
  }),

  beta: defineAnswer({
    description: "Propõe melhorias para as próximas vezes, cada uma com a evidência do climb. Um humano escolhe o que entra.",
    schema: z.strictObject({
      proposals: z.array(
        z.strictObject({
          kind: z.enum(["skill", "beta", "inspector", "config"]),
          target: z.string().min(3).describe("o arquivo que mudaria, ex.: .mohs/beta/titulos.md"),
          summary: z.string().min(3).max(280),
          evidence: z.array(z.string().min(3)).min(1),
          content: z.string().max(4000).optional().describe("o texto do arquivo, pronto para entrar"),
        }),
      ),
    }),
    example: {
      proposals: [
        {
          kind: "beta",
          target: ".mohs/beta/titulos.md",
          summary: "Títulos passam por normalizeTitle; use-o em toda operação que recebe título.",
          evidence: ["crew.note · route A · pitch 1"],
        },
      ],
    },
    hint: 'Nada a propor? {"proposals": []}. kind: skill (.mohs/rack), beta (.mohs/beta), inspector (.mohs/inspectors) ou config (mohs.yaml, aplicada à mão). evidence cita o que está acima como "tipo · route · pitch", ex.: "crew.note · route A · pitch 1". Com content, o humano aceita com um comando e o texto entra como está.',
    summarize: ({ proposals }) => (proposals.length ? plural(proposals.length, "proposta") : "nenhuma proposta"),
  }),

  rock: defineAnswer({
    description: "O ambiente está quebrado (dependência faltando, serviço fora, porta ocupada) e impede o trabalho.",
    schema: z.strictObject({ command: z.string(), error: z.string().max(500) }),
    example: { command: "npm test", error: "Cannot find module 'vitest'" },
    summarize: ({ command }) => command,
  }),
};

export type AnswerName = keyof typeof ANSWERS;
export type AnswerInput<N extends AnswerName> = z.output<(typeof ANSWERS)[N]["schema"]>;

/** An answer as a discriminated union: narrowing on `call` gives the right `input`. */
export type Answer<N extends AnswerName = AnswerName> = { [K in N]: { call: K; input: AnswerInput<K> } }[N];

/** The three calls a climber can end a pitch with. */
export const CLIMBER_ANSWERS = ["safe", "watch", "rock"] as const satisfies readonly AnswerName[];

/** After a FALL, the climber may also contest the sealed test with the line. */
export const FALL_FIX_ANSWERS = ["safe", "dispute", "watch", "rock"] as const satisfies readonly AnswerName[];

/** A talc fix has no line to doubt: instead of WATCH, the climber escalates to the full flow. */
export const TALC_ANSWERS = ["safe", "escalate", "rock"] as const satisfies readonly AnswerName[];

export function isAnswerName(value: unknown): value is AnswerName {
  return typeof value === "string" && Object.hasOwn(ANSWERS, value);
}

/** One line that confirms what the Basecamp accepted. */
export function summarizeAnswer(answer: Answer): string {
  return (ANSWERS[answer.call].summarize as (input: unknown) => string)(answer.input);
}

export type ParsedAnswer<N extends AnswerName> = { ok: true; answer: Answer<N> } | { ok: false; error: string };

/** Checks that `raw` is one of the answers this task accepts, with a valid input. */
export function parseAnswer<N extends AnswerName>(accepted: readonly N[], raw: unknown): ParsedAnswer<N> {
  const { call, input } = (raw ?? {}) as { call?: unknown; input?: unknown };
  if (!accepted.includes(call as N)) return { ok: false, error: `esta tarefa aceita só: ${accepted.join(", ")}` };
  const parsed = ANSWERS[call as N].schema.safeParse(input);
  if (!parsed.success) return { ok: false, error: describeIssues(parsed.error) };
  return { ok: true, answer: { call, input: parsed.data } as Answer<N> };
}

function describeIssues(error: z.ZodError): string {
  return error.issues.map((issue) => `${issue.path.join(".") || "resposta"}: ${issue.message}`).join("\n");
}

/** Size limits of an answer's fields, read from its schema, so an agent learns them before a refusal. */
export function answerLimits(name: AnswerName): string[] {
  const limits: string[] = [];
  const walk = (node: Record<string, unknown>, path: string) => {
    if (typeof node.maxLength === "number") limits.push(`${path}: até ${node.maxLength} caracteres`);
    if (typeof node.maxItems === "number") limits.push(`${path}: até ${node.maxItems} itens`);
    for (const [key, child] of Object.entries((node.properties ?? {}) as Record<string, Record<string, unknown>>)) {
      walk(child, path ? `${path}.${key}` : key);
    }
    if (node.items && typeof node.items === "object") walk(node.items as Record<string, unknown>, `${path}[]`);
  };
  walk(z.toJSONSchema(ANSWERS[name].schema, { unrepresentable: "any" }) as Record<string, unknown>, "");
  return limits;
}
