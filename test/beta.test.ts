import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { readEvents } from "../src/basecamp/event-log.ts";
import { CLI_ENTRY } from "../src/cli/invocation.ts";
import { getScenario } from "../src/drivers/fake/scenarios/index.ts";
import { project } from "../src/view/reducer.ts";
import { load, simulatedClimb, tempProject } from "./helpers.ts";

function mohs(root: string, ...args: string[]): { code: number; out: string } {
  try {
    return {
      code: 0,
      out: execFileSync(process.execPath, [CLI_ENTRY, ...args, "--cwd", root], {
        encoding: "utf8",
        env: { ...process.env, NO_COLOR: "1" },
      }),
    };
  } catch (error) {
    const failed = error as { status: number; stdout: string; stderr: string };
    return { code: failed.status, out: `${failed.stdout}${failed.stderr}` };
  }
}

describe("mohs beta: the human chooses what the scribe proposed", () => {
  it("writes an accepted proposal where the config loader finds it, and records every choice", async () => {
    const root = tempProject({ ".mohs/mohs.yaml": 'extends: ["mohs:react", "mohs:fastify"]\n' });
    const climb = simulatedClimb(getScenario("share-link"), { root });
    await climb.run();

    const listed = mohs(root, "beta");
    assert.match(listed.out, /b-01 · skill · rack\/share-tokens\/SKILL\.md · pendente/);

    const accepted = mohs(root, "beta", "accept", "b-01");
    assert.equal(accepted.code, 0, accepted.out);
    assert.match(accepted.out, /aceita · b-01 → \.mohs\/rack\/share-tokens\/SKILL\.md/);
    const skill = readFileSync(join(root, ".mohs/rack/share-tokens/SKILL.md"), "utf8");
    assert.match(skill, /^---\nname: share-tokens\ndescription: "Gerar tokens públicos/);
    assert.match(skill, /<!-- MOHs · b-01 do climb .* · evidência: inspection\.report · route A · security · high -->/);
    const config = load(root);
    assert.deepEqual(
      config.diagnostics.filter((d) => d.level === "error"),
      [],
    );
    assert.ok(
      config.skills.some((s) => s.name === "share-tokens"),
      "the new skill is part of the rack now",
    );

    assert.equal(mohs(root, "beta", "accept", "b-01").code, 1, "a proposal is chosen only once");
    assert.equal(mohs(root, "beta", "reject", "b-02").code, 0);
    assert.equal(mohs(root, "beta", "accept", "b-99").code, 1);

    const view = project(readEvents(climb.logFile));
    assert.deepEqual(
      view.proposals.map((p) => `${p.id}:${p.status}`),
      ["b-01:accepted", "b-02:rejected"],
    );
  });
});
