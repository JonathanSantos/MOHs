import type { Hardness, Role } from "../domain/types.ts";

/** Short hardness rules per role. Always identical text, placed right after the core instructions. */
const RULES: Record<Hardness, Partial<Record<Role, string>>> = {
  talc: {
    climber:
      "Hardness talc: correção pequena, sem plano nem line. Você decide o escopo: a menor mudança que resolve o pedido, com teste se o projeto tem testes. Cada escolha que o pedido não deixou clara vai em decisions no safe: o humano as lê e assina no fim. Se a correção pedir mais de 3 arquivos, tocar autenticação, pagamento, dados pessoais, migração ou links públicos, ou se o pedido estiver vago demais para decidir, responda escalate em vez de seguir.",
  },
  fluorite: {
    climber:
      "Hardness fluorite: mudança pequena. Um único pitch. Toque só os arquivos necessários. A anchor roda a suíte existente do projeto; se ela quebrar, o pitch volta para você.",
    belayer: "Hardness fluorite: escreva no máximo um teste de reprodução, e só se o pedido for um bug.",
    setter: "Hardness fluorite: line curta: o problema, os cenários QUANDO/ENTÃO e o que fica de fora. Sem bolts.",
  },
  quartz: {
    climber:
      "Hardness quartz: a line está assinada e os bolts estão fixos. Existem testes selados que você não verá; não tente encontrá-los. Siga os bolts à risca. Se a line estiver ambígua, use a call WATCH em vez de adivinhar.",
    belayer: "Hardness quartz: testes unitários e e2e para cada cenário QUANDO/ENTÃO da line, usando só os bolts como interface.",
    inspector: "Hardness quartz: revise só o diff da route, com a sua rubrica. Cite arquivo e linha em cada achado.",
    setter:
      "Hardness quartz: line completa, com cenários QUANDO/ENTÃO verificáveis. Os bolts vêm numa tarefa própria, depois da assinatura: não os escreva na line.",
  },
  diamond: {
    climber:
      "Hardness diamond: área sensível. Line e bolts assinados por um humano. Testes selados existem e a suíte completa do projeto também roda no send. Nenhum atalho: se algo não fecha, use WATCH.",
    belayer: "Hardness diamond: cubra casos de erro, limites e abuso, além dos cenários da line.",
    inspector: "Hardness diamond: todos os inspectors rodam. Seja específico e conservador na confiança.",
    setter: "Hardness diamond: explicite ameaças, dados sensíveis e o que nunca pode acontecer.",
  },
};

export function hardnessRules(hardness: Hardness, role: Role): string | null {
  return RULES[hardness][role] ?? null;
}
