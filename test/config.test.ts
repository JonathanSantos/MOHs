import assert from "node:assert/strict";
import { join } from "node:path";
import { describe, it } from "node:test";
import { detectProject } from "../src/cli/scaffold/detect.ts";
import { load, skill, tempProject } from "./helpers.ts";

describe("configuration layers", () => {
  it("falls back to the core when there is no .mohs", () => {
    const config = load(tempProject());
    assert.deepEqual(
      config.layers.map((l) => l.kind),
      ["core"],
    );
    assert.deepEqual(
      config.inspectors.map((i) => i.name),
      ["architecture", "security", "ui"],
    );
    assert.equal(config.settings.hardness.diamond.o2, 1_200_000);
    assert.equal(config.settings.rack.roles.climber.o2, 8_000);
    assert.deepEqual(config.brake.block, ["critical", "high"]);
    assert.equal(config.diagnostics.filter((d) => d.level === "error").length, 0);
  });

  it("places guidebooks before the project, which overrides items by name", () => {
    const root = tempProject({
      ".mohs/mohs.yaml": 'extends: ["mohs:react"]\n',
      ".mohs/rack/react-component/SKILL.md": skill("react-component", "description: ours\nwhen:\n  files: ['web/**/*.tsx']", "- our way"),
    });
    const config = load(root);
    assert.deepEqual(
      config.layers.map((l) => l.label),
      ["núcleo", "mohs:react", ".mohs"],
    );
    const reactSkill = config.skills.find((s) => s.name === "react-component");
    assert.equal(reactSkill?.layer, ".mohs");
    assert.deepEqual(reactSkill?.replaced, ["mohs:react"]);
    assert.equal(reactSkill?.body, "- our way");
  });

  it("chains relative guidebooks and reports circular extends", () => {
    const root = tempProject({
      ".mohs/mohs.yaml": "extends: [../team]\n",
      "team/mohs.yaml": "extends: [../base]\nmodels:\n  climber: kimi-k2.7-code\n",
      "base/mohs.yaml": "extends: [../team]\ncommands:\n  anchor: [npm run lint, npm test]\n",
    });
    const config = load(root);
    assert.deepEqual(
      config.layers.map((l) => l.label),
      ["núcleo", "../base", "../team", ".mohs"],
    );
    assert.equal(config.settings.models.climber, "kimi-k2.7-code");
    assert.ok(config.diagnostics.some((d) => d.level === "error" && d.message.includes("circular")));
  });

  it("merges objects deeply while arrays replace", () => {
    const root = tempProject({
      ".mohs/mohs.yaml": "extends: [./gb]\ncommands:\n  anchor: [npm run test:quick]\nmodels:\n  crux: claude-opus-5-5\n",
      ".mohs/gb/mohs.yaml":
        "commands:\n  anchor: [npm run lint, npm test]\n  send: [npm run test:full]\nmodels:\n  climber: kimi-k2.7-code\n",
    });
    const { settings } = load(root);
    assert.deepEqual(settings.commands.anchor, ["npm run test:quick"]);
    assert.deepEqual(settings.commands.send, ["npm run test:full"]);
    assert.equal(settings.models.climber, "kimi-k2.7-code");
    assert.equal(settings.models.crux, "claude-opus-5-5");
  });

  it("lets CLI flags win over every file", () => {
    const root = tempProject({ ".mohs/mohs.yaml": "hardness:\n  quartz: { o2: 500k }\n" });
    assert.equal(load(root, { hardness: { quartz: { o2: "200k" } } }).settings.hardness.quartz.o2, 200_000);
  });

  it("points schema errors at file and line, including unknown keys", () => {
    const root = tempProject({ ".mohs/mohs.yaml": "rack:\n  climber:\n    o2: lots\n  pilot:\n    always: []\n" });
    const errors = load(root).diagnostics.filter((d) => d.level === "error");
    const badValue = errors.find((d) => d.message.startsWith("rack.climber.o2"));
    assert.equal(badValue?.file, join(root, ".mohs", "mohs.yaml"));
    assert.equal(badValue?.line, 3);
    assert.equal(errors.find((d) => d.message.includes("pilot"))?.line, 4);
  });

  it("points frontmatter errors at their line and warns when a skill name differs from its folder", () => {
    const root = tempProject({
      ".mohs/rack/Bad/SKILL.md": "---\nname: Bad Name\ndescription: x\n---\n\nbody\n",
      ".mohs/rack/folder/SKILL.md": skill("other-name", "description: x"),
    });
    const { diagnostics, skills } = load(root);
    const badName = diagnostics.find((d) => d.message.startsWith("name"));
    assert.equal(badName?.level, "error");
    assert.equal(badName?.line, 2);
    assert.ok(diagnostics.some((d) => d.level === "warn" && d.message.includes('mas a pasta é "folder"')));
    assert.deepEqual(
      skills.map((s) => s.name),
      ["other-name"],
    );
  });

  it("reuses skills from other tools, with .mohs having the last word", () => {
    const root = tempProject({
      ".mohs/mohs.yaml": "rack:\n  sources: [.claude/skills]\n",
      ".claude/skills/deploy/SKILL.md": skill("deploy", "description: how we deploy\nallowed-tools: Bash"),
      ".claude/skills/review/SKILL.md": skill("review", "description: review"),
      ".mohs/rack/review/SKILL.md": skill("review", "description: MOHs review\nroles: [inspector]"),
    });
    const config = load(root);
    const deploy = config.skills.find((s) => s.name === "deploy");
    assert.equal(deploy?.layer, ".claude/skills");
    assert.deepEqual(deploy?.roles, ["climber"]);
    assert.equal(deploy?.load, "index");
    const review = config.skills.find((s) => s.name === "review");
    assert.equal(review?.layer, ".mohs");
    assert.deepEqual(review?.replaced, [".claude/skills"]);
  });

  it("warns when rack.<role>.always names a skill that does not exist", () => {
    const root = tempProject({ ".mohs/mohs.yaml": "rack:\n  climber:\n    always: [ghost]\n" });
    assert.ok(load(root).diagnostics.some((d) => d.level === "warn" && d.message.includes("ghost")));
  });
});

describe("brake floors", () => {
  it("always blocks critical and caps falls_before_rescue", () => {
    const root = tempProject({ ".mohs/brake.yaml": "block: [high]\nwarn: [critical, medium]\nignore: [low]\nfalls_before_rescue: 9\n" });
    const { brake, diagnostics } = load(root);
    assert.deepEqual(brake.block, ["critical", "high"]);
    assert.deepEqual(brake.warn, ["medium"]);
    assert.equal(brake.fallsBeforeRescue, 5);
    assert.ok(diagnostics.some((d) => d.message.includes("critical sempre bloqueia")));
    assert.ok(diagnostics.some((d) => d.message.includes("limitado a 5")));
  });

  it("resolves a severity listed twice to the stricter bucket", () => {
    const { brake } = load(tempProject({ ".mohs/brake.yaml": "block: [critical, medium]\nwarn: [medium, high]\n" }));
    assert.ok(brake.block.includes("medium"));
    assert.ok(brake.warn.includes("high"));
  });
});

describe("mohs init detection", () => {
  const detect = (pkg: object) => detectProject(tempProject({ "package.json": JSON.stringify(pkg) }));

  it("finds how to run one sealed test file, for unit and e2e", () => {
    assert.equal(detect({ scripts: { test: "node --test" } }).seal, "node --test {file}");
    assert.equal(detect({ devDependencies: { vitest: "3" } }).seal, "npx vitest run {file}");
    assert.equal(detect({ devDependencies: { jest: "30" }, scripts: { test: "node --test" } }).seal, "npx jest {file}");
    assert.equal(detect({ devDependencies: { "@playwright/test": "1" } }).sealE2e, "npx playwright test {file}");
    assert.equal(detect({ scripts: { test: "echo sem testes" } }).seal, "node --test {file}", "node:test comes with Node");
  });

  it("plans the tests once: what runs now, what is recommended for the stack and how to switch", () => {
    const react = detect({ dependencies: { react: "19", vite: "7" } });
    assert.equal(react.seal, "node --test {file}", "works right away, with nothing to install");
    assert.equal(react.tests.recommended?.id, "vitest-dom");
    assert.match(react.tests.recommended?.install ?? "", /@testing-library\/react/);
    assert.equal(react.tests.e2e?.recommended?.id, "playwright");
    assert.equal(react.tests.testFiles, 0);

    const chosen = detectProject(tempProject({ "package.json": '{"dependencies":{"react":"19"}}' }), "vitest-dom");
    assert.equal(chosen.seal, "npx vitest run {file}");
    const withRunner = detect({ devDependencies: { jest: "30" } });
    assert.equal(withRunner.tests.recommended?.id, "jest", "a project with its own runner keeps it");
    assert.equal(detectProject(tempProject({ "requirements.txt": "flask\n" })).tests.recommended?.id, "pytest");
  });

  it("falls back to the language's own runner when the project has no tests", () => {
    assert.equal(detectProject(tempProject({ "requirements.txt": "flask\n" })).seal, "python3 {file}");
    assert.equal(detectProject(tempProject({ "pyproject.toml": "[tool.pytest.ini_options]\n" })).seal, "python3 -m pytest {file}");
    assert.equal(detectProject(tempProject({ "go.mod": "module x\n" })).seal, undefined, "other stacks say it in commands.seal");
  });
});
