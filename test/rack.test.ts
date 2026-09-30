import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { classifyFindings } from "../src/brake/findings.ts";
import type { Hardness } from "../src/domain/types.ts";
import { buildPack } from "../src/pack/build.ts";
import { selectInspectors, selectSkills } from "../src/rack/select.ts";
import { load, skill, tempProject } from "./helpers.ts";

const LONG_BODY = "- rule\n".repeat(460);

function teamProject() {
  return tempProject({
    ".mohs/mohs.yaml": 'extends: ["mohs:react", "mohs:fastify"]\nrack:\n  climber:\n    always: [house-style]\n    exclude: [legacy]\n',
    ".mohs/rack/house-style/SKILL.md": skill("house-style", "description: team style"),
    ".mohs/rack/legacy/SKILL.md": skill("legacy", "description: old way\nwhen:\n  files: ['**/*.tsx']"),
    ".mohs/rack/payments/SKILL.md": skill(
      "payments",
      "description: payments\nwhen:\n  files: ['server/**']\n  hardness: [diamond]\n  tags: [billing]",
    ),
    ".mohs/rack/glossary/SKILL.md": skill("glossary", "description: domain terms"),
    ".mohs/beta/sdk.md": "---\nwhen:\n  files: ['server/**']\n---\nThe payments SDK lives in server/vendor/pay.\n",
    ".mohs/beta/general.md": "Commits in Portuguese.\n",
  });
}

describe("rack selection", () => {
  it("picks by file, hardness and tag; always and exclude come from mohs.yaml", () => {
    const selection = selectSkills(load(teamProject()), { role: "climber", hardness: "quartz", files: ["web/src/App.tsx"], tags: [] });
    assert.deepEqual(
      selection.included.map((m) => m.item.name),
      ["house-style", "react-component"],
    );
    assert.deepEqual(
      selection.indexed.map((m) => m.item.name),
      ["glossary"],
    );
    assert.deepEqual(
      selection.excluded.map((e) => e.name),
      ["legacy"],
    );
  });

  it("requires every condition of the when clause", () => {
    const config = load(teamProject());
    const skillsFor = (hardness: Hardness, tags: string[]) =>
      selectSkills(config, { role: "climber", files: ["server/src/pay.ts"], hardness, tags }).included.map((m) => m.item.name);
    assert.ok(!skillsFor("quartz", ["billing"]).includes("payments"));
    assert.ok(!skillsFor("diamond", []).includes("payments"));
    assert.ok(skillsFor("diamond", ["billing"]).includes("payments"));
  });

  it("respects roles: a belayer skill never reaches the climber", () => {
    const config = load(tempProject({ ".mohs/mohs.yaml": 'extends: ["mohs:playwright"]\n' }));
    const query = { hardness: "quartz" as const, files: [], tags: [] };
    assert.equal(selectSkills(config, { ...query, role: "climber" }).included.length, 0);
    assert.deepEqual(
      selectSkills(config, { ...query, role: "belayer" }).included.map((m) => m.item.name),
      ["playwright-e2e"],
    );
  });

  it("moves skills past the O₂ budget to overflow, packing the most specific first", () => {
    const root = tempProject({
      ".mohs/mohs.yaml": "rack:\n  climber:\n    o2: 600\n",
      ".mohs/rack/general/SKILL.md": skill("general", "description: general\nwhen:\n  files: ['**/*.tsx']", LONG_BODY),
      ".mohs/rack/specific/SKILL.md": skill("specific", "description: specific\nwhen:\n  files: ['web/src/features/**/*.tsx']", LONG_BODY),
    });
    const query = { role: "climber" as const, hardness: "quartz" as const, files: ["web/src/features/a/A.tsx"], tags: [] };

    const tight = selectSkills(load(root), query);
    assert.deepEqual(tight.included, []);
    assert.deepEqual(
      tight.overflow.map((m) => m.item.name),
      ["specific", "general"],
    );

    const roomy = selectSkills(load(root, { rack: { climber: { o2: 1000 } } }), query);
    assert.deepEqual(
      roomy.included.map((m) => m.item.name),
      ["specific"],
    );
    assert.deepEqual(
      roomy.overflow.map((m) => m.item.name),
      ["general"],
    );
  });

  it("runs no inspector on fluorite, the triggered ones on quartz and all of them on diamond", () => {
    const config = load(tempProject());
    const names = (hardness: Hardness, files: string[]) => selectInspectors(config, hardness, files).map((i) => i.name);
    assert.deepEqual(names("fluorite", ["server/src/a.ts"]), []);
    assert.deepEqual(names("quartz", ["web/src/App.tsx"]), ["architecture", "ui"]);
    assert.deepEqual(names("quartz", ["server/src/routes/a.ts"]), ["architecture", "security"]);
    assert.deepEqual(names("diamond", ["README.md"]), ["architecture", "security", "ui"]);
  });
});

describe("pack", () => {
  it("keeps a fixed order: core, hardness, skills, index, beta, then what changes per call", () => {
    const pack = buildPack(load(teamProject()), {
      role: "climber",
      hardness: "quartz",
      files: ["server/src/routes/pay.ts"],
      tags: [],
      line: "# Line",
      task: "Pitch 1",
    });
    assert.deepEqual(
      pack.sections.map((s) => s.kind),
      ["core", "hardness", "skills", "skills", "skill-index", "beta", "beta", "line", "task"],
    );
    assert.deepEqual(pack.skills, ["house-style", "fastify-route"]);
    assert.deepEqual(pack.beta, ["general", "sdk"]);
    assert.equal(
      pack.tokens,
      pack.sections.reduce((sum, s) => sum + s.tokens, 0),
    );
  });

  it("is deterministic: same request, same pack", () => {
    const config = load(teamProject());
    const request = {
      role: "climber" as const,
      hardness: "diamond" as const,
      files: ["web/src/App.tsx", "server/src/a.ts"],
      tags: ["billing"],
    };
    assert.deepEqual(buildPack(config, request).sections, buildPack(config, request).sections);
  });
});

describe("brake findings", () => {
  it("applies the policy and minimum confidence; critical is never dropped", () => {
    const { brake } = load(tempProject());
    const actions = classifyFindings(
      [
        { inspector: "security", severity: "critical", area: "s", text: "a", confidence: 10 },
        { inspector: "security", severity: "high", area: "s", text: "b", confidence: 90 },
        { inspector: "ui", severity: "medium", area: "u", text: "c", confidence: 85 },
        { inspector: "ui", severity: "low", area: "u", text: "d", confidence: 95 },
        { inspector: "ui", severity: "high", area: "u", text: "e", confidence: 50 },
      ],
      brake,
    ).map((f) => f.action);
    assert.deepEqual(actions, ["block", "block", "warn", "ignore", "dropped"]);
  });
});
