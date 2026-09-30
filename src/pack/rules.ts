import type { Hardness, Role } from "../domain/types.ts";

/** Short hardness rules per role. Always identical text, placed right after the core instructions. */
const RULES: Record<Hardness, Partial<Record<Role, string>>> = {
  talc: {
    climber:
      "Hardness talc: correção pequena, sem plano nem line. Você decide o escopo: a menor mudança que resolve o pedido, com teste se o projeto tem testes. Cada escolha que o pedido não deixou clara vai em decisions no safe: o humano as lê e assina no fim. Se a correção pedir mais de 3 arquivos de código (testes e documentação não contam), tocar autenticação, pagamento, dados pessoais, migração ou links públicos, ou se o pedido estiver vago demais para decidir, responda escalate em vez de seguir.",
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

/**
 * A solo climb (one agent, no subagents) writes the route's tests first and sees them: locked by the Basecamp instead
 * of sealed, since a secret its own author knows proves nothing.
 */
const SOLO_RULES: Partial<Record<Hardness, Partial<Record<Role, string>>>> = {
  quartz: {
    climber:
      "Hardness quartz, climb solo: a line está assinada e os bolts estão fixos. Os testes da route vieram antes do código e estão abaixo. O Basecamp guarda a cópia dele e a roda no send: mudar os testes aqui não muda nada. Faça-os passar seguindo os bolts; se um teste contradiz a line, responda dispute. Se a line estiver ambígua, use a call WATCH em vez de adivinhar.",
    belayer:
      "Hardness quartz, climb solo (TDD): antes de qualquer código, escreva um teste para cada cenário QUANDO/ENTÃO da line, usando só os bolts como interface. Todos precisam falhar no código de hoje. Depois o Basecamp os trava: você os lerá como climber, mas não poderá mudá-los.",
  },
  diamond: {
    climber:
      "Hardness diamond, climb solo: área sensível. Line e bolts assinados por um humano. Os testes da route vieram antes do código e estão abaixo; o Basecamp roda a cópia dele e a suíte completa do projeto no send. Nenhum atalho: se algo não fecha, use WATCH.",
    belayer:
      "Hardness diamond, climb solo (TDD): antes de qualquer código, escreva os testes da line, com casos de erro, limites e abuso, usando só os bolts. Todos precisam falhar no código de hoje; depois o Basecamp os trava.",
  },
};

export function hardnessRules(hardness: Hardness, role: Role, solo = false): string | null {
  return (solo ? SOLO_RULES[hardness]?.[role] : undefined) ?? RULES[hardness][role] ?? null;
}
