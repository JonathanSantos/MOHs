import { join, relative } from "node:path";
import { surveyRepository } from "../../survey/survey.ts";
import { listDir, readText } from "../../util/fs.ts";
import { planTests, TEST_OPTIONS, type TestOptionId, type TestPlan } from "./test-plan.ts";

export interface ProjectProfile {
  anchor: string[];
  send: string[];
  /** How to run one sealed test file (`{file}`), unit and e2e. */
  seal?: string;
  sealE2e?: string;
  /** What the project has for tests and what is recommended. */
  tests: TestPlan;
  dev?: string;
  guidebooks: string[];
  workspaces: string[];
}

interface PackageJson {
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

/** Dependency → guidebook it suggests. */
const GUIDEBOOK_BY_DEPENDENCY: Record<string, string> = {
  react: "mohs:react",
  fastify: "mohs:fastify",
  "@playwright/test": "mohs:playwright",
};

/** Checks run at every anchor, first match wins within each group. */
const ANCHOR_SCRIPTS: readonly (readonly string[])[] = [["typecheck"], ["lint"], ["test:quick", "test:unit", "test"]];
const SEND_SCRIPTS: readonly string[] = ["test:full", "test:e2e", "test"];

const PYTHON_MANIFESTS = ["pyproject.toml", "requirements.txt", "requirements-dev.txt", "setup.py"];

/** Reads package.json at the root and one level down (workspaces) to suggest commands and guidebooks. */
export function detectProject(projectRoot: string, chosen?: TestOptionId): ProjectProfile {
  const manifest = readPackage(projectRoot);
  const root = manifest ?? {};
  const workspaces = listDir(projectRoot)
    .filter((entry) => !entry.startsWith(".") && entry !== "node_modules")
    .map((entry) => ({ dir: join(projectRoot, entry), pkg: readPackage(join(projectRoot, entry)) }))
    .filter((w): w is { dir: string; pkg: PackageJson } => w.pkg !== null);

  const scripts = root.scripts ?? {};
  const run = (script: string) => (script === "test" ? "npm test" : `npm run ${script}`);
  const firstPresent = (candidates: readonly string[]) => candidates.find((script) => script in scripts);
  const dependencies = new Set(
    [root, ...workspaces.map((w) => w.pkg)].flatMap((pkg) => [
      ...Object.keys(pkg.dependencies ?? {}),
      ...Object.keys(pkg.devDependencies ?? {}),
    ]),
  );

  const pythonManifests = PYTHON_MANIFESTS.map((file) => readText(join(projectRoot, file)));
  const tests = planTests({
    node: manifest !== null || workspaces.length > 0,
    python: pythonManifests.some((text) => text !== null),
    dependencies,
    testScript: scripts.test ?? "",
    pythonManifests: pythonManifests.join("\n"),
    testFiles: surveyRepository(projectRoot).tests ?? 0,
  });
  const pick = chosen ? TEST_OPTIONS[chosen] : undefined;
  const e2e = pick?.id === "playwright" ? pick : tests.e2e?.current;

  return {
    tests,
    anchor: ANCHOR_SCRIPTS.map(firstPresent)
      .filter((s): s is string => Boolean(s))
      .map(run),
    send: [firstPresent(SEND_SCRIPTS)].filter((s): s is string => Boolean(s)).map(run),
    seal: (pick && pick.id !== "playwright" ? pick : tests.current)?.seal,
    sealE2e: e2e?.seal,
    dev: "dev" in scripts ? "npm run dev" : undefined,
    guidebooks: Object.entries(GUIDEBOOK_BY_DEPENDENCY)
      .filter(([dependency]) => dependencies.has(dependency))
      .map(([, guidebook]) => guidebook),
    workspaces: workspaces.map((w) => relative(projectRoot, w.dir)),
  };
}

function readPackage(dir: string): PackageJson | null {
  const text = readText(join(dir, "package.json"));
  if (!text) return null;
  try {
    return JSON.parse(text) as PackageJson;
  } catch {
    return null;
  }
}
