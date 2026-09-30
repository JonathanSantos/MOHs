import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Basecamp } from "../src/basecamp/basecamp.ts";
import { FileDesk, type Desk } from "../src/basecamp/desk.ts";
import { loadConfig } from "../src/config/load.ts";
import type { MohsYaml } from "../src/config/schema.ts";
import type { Crew } from "../src/crew/types.ts";
import { FakeCrew } from "../src/drivers/fake/fake-crew.ts";
import { FakeRunner } from "../src/drivers/fake/fake-runner.ts";
import type { Scenario } from "../src/drivers/fake/scenarios/index.ts";
import { writeTree } from "../src/util/fs.ts";

export function tempProject(files: Record<string, string> = {}): string {
  const dir = mkdtempSync(join(tmpdir(), "mohs-test-"));
  writeTree(dir, files);
  return dir;
}

/** Loads config without the user layer, so tests never depend on ~/.mohs. */
export function load(projectRoot: string, overrides?: MohsYaml) {
  return loadConfig({ projectRoot, userDir: null, overrides });
}

export function skill(name: string, frontmatter: string, body = "- do it this way"): string {
  return `---\nname: ${name}\n${frontmatter}\n---\n\n${body}\n`;
}

interface TestClimbOptions {
  desk?: Desk;
  root?: string;
  overrides?: MohsYaml;
  crew?: Crew;
}

/** A Basecamp with the simulated crew at infinite speed, auto-signing and retrying every rescue. */
export function simulatedClimb(scenario: Scenario, options: TestClimbOptions = {}): Basecamp {
  const root = options.root ?? tempProject({ ".mohs/mohs.yaml": 'extends: ["mohs:react", "mohs:fastify"]\n' });
  return new Basecamp({
    config: load(root, options.overrides),
    crew: options.crew ?? new FakeCrew(scenario, Infinity),
    runner: new FakeRunner(scenario, Infinity),
    desk: options.desk ?? new FileDesk({ autoSign: true, autoRescue: "retry" }),
    request: scenario.request,
    scenario: scenario.name,
  });
}
