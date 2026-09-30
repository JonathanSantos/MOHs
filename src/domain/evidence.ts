/** How much the checks that ran prove about a route: tests beat builds, and two kinds of tests beat one. */
export const EVIDENCE_GRADES = ["forte", "média", "fraca", "nenhuma"] as const;
export type EvidenceGrade = (typeof EVIDENCE_GRADES)[number];

export interface Evidence {
  grade: EvidenceGrade;
  /** What ran and passed, for people: "3 testes selados", "testes do projeto (npm test)". */
  proofs: string[];
}

export interface EvidenceInput {
  /** Sealed test files that passed in the send. */
  sealed: number;
  /** Commands the harness ran and saw pass (anchor, and the full suite in diamond). */
  commands: readonly string[];
  /** Test files in the project after the route: those it had plus those the route added. */
  projectTests: number;
  /** The project's TypeScript checks that ran on the route. */
  checks: number;
}

/** Commands that run tests, as opposed to building, linting or type checking. */
const TEST_COMMAND = /\b(?:test|tests|spec|vitest|jest|mocha|pytest|unittest|playwright|cypress|ava)\b|--test\b/;

export function isTestCommand(command: string): boolean {
  return TEST_COMMAND.test(command);
}

/**
 * Grades what proved a route. A test command in a project without tests proves nothing about behaviour, so it
 * counts with the builds and lints. Sealed tests and the project's own tests are the two kinds of real proof.
 */
export function gradeEvidence({ sealed, commands, projectTests, checks }: EvidenceInput): Evidence {
  const testCommands = projectTests > 0 ? commands.filter(isTestCommand) : [];
  const others = commands.filter((command) => !testCommands.includes(command));
  const proofs = [
    ...(sealed ? [`${sealed} ${sealed === 1 ? "teste selado" : "testes selados"}`] : []),
    ...(testCommands.length ? [`testes do projeto (${testCommands.join(", ")})`] : []),
    ...(others.length ? [`checagens sem teste (${others.join(", ")})`] : []),
    ...(checks ? [`${checks} ${checks === 1 ? "check" : "checks"} do projeto`] : []),
  ];
  const kinds = Number(sealed > 0) + Number(testCommands.length > 0);
  const grade: EvidenceGrade = kinds === 2 ? "forte" : kinds === 1 ? "média" : proofs.length ? "fraca" : "nenhuma";
  return { grade, proofs };
}

/** One line for people, e.g. "evidência média: 3 testes selados". */
export function describeEvidence({ grade, proofs }: Evidence): string {
  return `evidência ${grade}${proofs.length ? `: ${proofs.join(" · ")}` : ": nada rodou além do commit"}`;
}
