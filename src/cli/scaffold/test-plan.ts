/** One way to run a sealed test file, as `mohs init` offers it. */
export interface TestOption {
  id: string;
  label: string;
  /** How one test file runs; `{file}` is its path. */
  seal: string;
  /** What to install first; absent when the stack already has it. */
  install?: string;
  why: string;
}

/** What the project has and what `mohs init` recommends, so the choice is made once, before any climb. */
export interface TestPlan {
  stack: string;
  /** Test files the project already has. */
  testFiles: number;
  /** What sealed tests run with if nobody changes anything: the project's runner, or the language's own. */
  current?: TestOption;
  recommended?: TestOption;
  alternatives: TestOption[];
  e2e?: { current?: TestOption; recommended?: TestOption };
}

/** What detection found, in plain facts; the plan is decided from these alone, by rule. */
export interface StackFacts {
  node: boolean;
  python: boolean;
  dependencies: ReadonlySet<string>;
  testScript: string;
  /** The Python manifests' text, to spot pytest. */
  pythonManifests: string;
  testFiles: number;
}

export const TEST_OPTIONS = {
  "node-test": {
    id: "node-test",
    label: "node:test (vem com o Node)",
    seal: "node --test {file}",
    why: "nenhuma dependência nova; roda .js e .ts",
  },
  vitest: { id: "vitest", label: "vitest", seal: "npx vitest run {file}", install: "npm i -D vitest", why: "rápido, com watch e mocks" },
  "vitest-dom": {
    id: "vitest-dom",
    label: "vitest + Testing Library",
    seal: "npx vitest run {file}",
    install: "npm i -D vitest jsdom @testing-library/react @testing-library/user-event",
    why: "testa componentes React com DOM (cada arquivo pede jsdom com // @vitest-environment jsdom)",
  },
  jest: { id: "jest", label: "jest", seal: "npx jest {file}", why: "o runner que o projeto já usa" },
  mocha: { id: "mocha", label: "mocha", seal: "npx mocha {file}", why: "o runner que o projeto já usa" },
  pytest: {
    id: "pytest",
    label: "pytest",
    seal: "python3 -m pytest {file}",
    install: "pip install pytest",
    why: "o padrão do ecossistema Python",
  },
  unittest: { id: "unittest", label: "unittest (vem com o Python)", seal: "python3 {file}", why: "nenhuma dependência nova" },
  playwright: {
    id: "playwright",
    label: "Playwright",
    seal: "npx playwright test {file}",
    install: "npm i -D @playwright/test && npx playwright install chromium",
    why: "e2e num navegador de verdade",
  },
} as const satisfies Record<string, TestOption>;

export type TestOptionId = keyof typeof TEST_OPTIONS;

export function isTestOptionId(value: unknown): value is TestOptionId {
  return typeof value === "string" && Object.hasOwn(TEST_OPTIONS, value);
}

/** The runner a Node project already uses, first match wins (specific runners before node:test). */
const NODE_RUNNERS: readonly { uses: (facts: StackFacts) => boolean; option: TestOption }[] = [
  { uses: ({ dependencies }) => dependencies.has("vitest"), option: TEST_OPTIONS.vitest },
  { uses: ({ dependencies }) => dependencies.has("jest"), option: TEST_OPTIONS.jest },
  { uses: ({ dependencies }) => dependencies.has("mocha"), option: TEST_OPTIONS.mocha },
  { uses: ({ testScript }) => /\bnode\b.*--test\b/.test(testScript), option: TEST_OPTIONS["node-test"] },
];

/** Stacks in order; the first that matches plans the tests. */
const STACKS: readonly { matches: (facts: StackFacts) => boolean; plan: (facts: StackFacts) => Omit<TestPlan, "testFiles" | "e2e"> }[] = [
  {
    matches: ({ node }) => node,
    plan: (facts) => {
      const react = facts.dependencies.has("react");
      const stack = react ? "Node + React" : "Node";
      const runner = NODE_RUNNERS.find((candidate) => candidate.uses(facts))?.option;
      if (runner) return { stack, current: runner, recommended: runner, alternatives: [] };
      const builtIn = TEST_OPTIONS["node-test"];
      return react
        ? { stack, current: builtIn, recommended: TEST_OPTIONS["vitest-dom"], alternatives: [builtIn] }
        : { stack, current: builtIn, recommended: builtIn, alternatives: [TEST_OPTIONS.vitest] };
    },
  },
  {
    matches: ({ python }) => python,
    plan: ({ pythonManifests }) =>
      pythonManifests.includes("pytest")
        ? { stack: "Python", current: TEST_OPTIONS.pytest, recommended: TEST_OPTIONS.pytest, alternatives: [] }
        : { stack: "Python", current: TEST_OPTIONS.unittest, recommended: TEST_OPTIONS.pytest, alternatives: [TEST_OPTIONS.unittest] },
  },
];

export function planTests(facts: StackFacts): TestPlan {
  const stack = STACKS.find((candidate) => candidate.matches(facts));
  const base = stack?.plan(facts) ?? { stack: "outra", alternatives: [] };
  const playwright = facts.dependencies.has("@playwright/test");
  const web = facts.dependencies.has("react");
  const e2e = playwright ? { current: TEST_OPTIONS.playwright } : web ? { recommended: TEST_OPTIONS.playwright } : undefined;
  return { ...base, testFiles: facts.testFiles, e2e };
}
