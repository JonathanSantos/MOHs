/**
 * Decisions of a line: the points the request leaves open, each with two or three answers, the recommended one first.
 * The human signs with the recommendations or picks another answer (or writes one); the signed line keeps only what
 * was decided, which is what the belayer tests and the climber builds.
 */
export interface LineOption {
  choice: string;
  why: string;
}

export interface LineDecision {
  /** D1, D2…: set by the Basecamp, in the order the setter wrote them. */
  id: string;
  question: string;
  /** The situation, so the decision reads as a scenario: QUANDO {when} ENTÃO {answer}. */
  when?: string;
  /** Two or three; the first is the recommended one. */
  options: LineOption[];
  /** The words of the request the recommended option goes against, when it does: the human sees a warning. */
  against?: string;
}

/** How a decision was settled at the signature: the recommendation, another option, or the human's own words. */
export type SettledBy = "recommended" | "option" | "human";

export interface SettledDecision {
  id: string;
  question: string;
  when?: string;
  answer: string;
  by: SettledBy;
}

export const DECISIONS_HEADING = "## Decisões";

export const optionLetter = (index: number): string => String.fromCharCode(65 + index);

/** `D1=B` or `D2=as palavras do humano`: a choice given at the signature. */
export function parseChoice(arg: string): [string, string] | null {
  const match = /^(D\d+)\s*=\s*([\s\S]+)$/i.exec(arg.trim());
  return match ? [match[1].toUpperCase(), match[2].trim()] : null;
}

export function numberDecisions(decisions: readonly Omit<LineDecision, "id">[]): LineDecision[] {
  return decisions.map((decision, index) => ({ id: `D${index + 1}`, ...decision }));
}

/** The line as the human reviews it: the setter's text, then every decision with its options. */
export function reviewLine(body: string, decisions: readonly LineDecision[]): string {
  if (!decisions.length) return body;
  const blocks = decisions.map((decision) =>
    [
      `### ${decision.id} · ${decision.question}`,
      "",
      ...(decision.when ? [`QUANDO ${decision.when}, ENTÃO:`, ""] : []),
      ...decision.options.map(
        (option, index) => `- **${optionLetter(index)}${index === 0 ? " (recomendada)" : ""}:** ${option.choice} ${option.why}`,
      ),
      ...(decision.against ? ["", `⚠ A recomendada contraria o pedido: "${decision.against}"`] : []),
    ].join("\n"),
  );
  return [
    body.trimEnd(),
    "",
    DECISIONS_HEADING,
    "",
    'A recomendada de cada decisão é a A. Para ficar com outra ou responder com as suas palavras, assine escolhendo: `mohs sign D1=B "D2=…"`.',
    "",
    blocks.join("\n\n"),
    "",
  ].join("\n");
}

/** The line as it was signed: the setter's text and, for each decision, only the answer that stands. */
export function signedLine(body: string, settled: readonly SettledDecision[]): string {
  if (!settled.length) return body;
  const label: Record<SettledBy, string> = { recommended: "recomendada", option: "escolhida pelo humano", human: "resposta do humano" };
  // Com a situação, a decisão vira um cenário como os outros: o belayer a testa e o teto de testes a conta.
  const rows = settled.map((decision) =>
    decision.when
      ? `- ${decision.id} · QUANDO ${decision.when} ENTÃO ${decision.answer} (${label[decision.by]})`
      : `- ${decision.id} · ${decision.question} → ${decision.answer} (${label[decision.by]})`,
  );
  return [body.trimEnd(), "", DECISIONS_HEADING, "", ...rows, ""].join("\n");
}

/**
 * Applies the human's choices (`D1` → `B`, or the human's own words). Undecided decisions keep the recommendation.
 * An unknown decision or an option the decision does not have is a problem, never a silent guess.
 */
export function settle(
  decisions: readonly LineDecision[],
  choices: Readonly<Record<string, string>> = {},
): { settled: SettledDecision[]; problems: string[] } {
  const problems = Object.keys(choices)
    .filter((id) => !decisions.some((decision) => decision.id === id.toUpperCase()))
    .map((id) => `a line não tem a decisão ${id} (tem ${decisions.map((d) => d.id).join(", ") || "nenhuma"})`);
  const byId = new Map(Object.entries(choices).map(([id, value]) => [id.toUpperCase(), value.trim()]));
  const settled = decisions.map((decision): SettledDecision => {
    const value = byId.get(decision.id);
    const recommended = {
      id: decision.id,
      question: decision.question,
      ...(decision.when ? { when: decision.when } : {}),
      answer: decision.options[0].choice,
      by: "recommended" as const,
    };
    if (!value) return recommended;
    if (/^[A-Za-z]$/.test(value)) {
      const index = value.toUpperCase().charCodeAt(0) - 65;
      const option = decision.options[index];
      if (!option) {
        problems.push(`${decision.id} não tem a opção ${value.toUpperCase()} (vai de A a ${optionLetter(decision.options.length - 1)})`);
        return recommended;
      }
      return { ...recommended, answer: option.choice, by: index === 0 ? "recommended" : "option" };
    }
    return { ...recommended, answer: value, by: "human" };
  });
  return { settled, problems };
}

const normalize = (text: string) =>
  text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/["'“”‘’`]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();

/**
 * Keeps an `against` warning only when it quotes the request: a warning that cites nothing the request says is noise
 * the human learns to ignore. Returns the decisions as they stand and the ids whose warning was dropped.
 */
export function checkAgainst(decisions: readonly LineDecision[], request: string): { decisions: LineDecision[]; dropped: string[] } {
  const said = normalize(request);
  const dropped: string[] = [];
  const kept = decisions.map((decision) => {
    if (!decision.against || said.includes(normalize(decision.against))) return decision;
    dropped.push(decision.id);
    const { against: _against, ...rest } = decision;
    return rest;
  });
  return { decisions: kept, dropped };
}
