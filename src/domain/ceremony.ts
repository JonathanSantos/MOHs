import type { Intent } from "./types.ts";

/**
 * The checks each kind of request brings, on top of its hardness. The hardness says how much a mistake costs; the
 * intent says what proof fits the change: a bug is proven by a test that failed before and passes after, a refactoring
 * by the tests that already existed passing untouched, new code by decisions a human made up front.
 */
export interface Ceremony {
  label: string;
  /** A reproducer writes a test that fails today before anyone plans the fix; it must pass at the send. */
  reproduce: boolean;
  /** Test files that existed before the route cannot change: the old tests are the proof nothing moved. */
  keepTests: boolean;
  /** What the setter keeps in mind when writing the line. */
  setter: string;
}

export const CEREMONIES: Record<Intent, Ceremony> = {
  fix: {
    label: "correção de bug",
    reproduce: true,
    keepTests: false,
    setter:
      "Correção de bug: há um teste de reprodução que falha hoje (abaixo, quando houver). A line diz o comportamento certo, o que não pode mudar em volta dele e os casos vizinhos do bug.",
  },
  feature: {
    label: "feature em código existente",
    reproduce: false,
    keepTests: false,
    setter: "Feature em código que existe: diga o que muda e, com a mesma clareza, o que não pode mudar para quem já usa o código.",
  },
  refactor: {
    label: "refatoração",
    reproduce: false,
    keepTests: true,
    setter:
      "Refatoração: o comportamento não muda. Os testes que já existem ficam como estão e são a prova; a line diz o que muda por dentro e o que precisa continuar igual por fora.",
  },
  new: {
    label: "código novo",
    reproduce: false,
    keepTests: false,
    setter:
      "Código novo: não há comportamento antigo a proteger, então as decisões pesam mais que os testes. Cada escolha de API e de borda que o pedido deixa aberta vira uma decisão.",
  },
};
