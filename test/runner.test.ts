import assert from "node:assert/strict";
import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, realpathSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import type { PlannedRoute } from "../src/domain/plan.ts";
import { LocalRunner } from "../src/runner/local-runner.ts";
import { runShell } from "../src/runner/shell.ts";
import { dependencyFolders, linkDependencies } from "../src/workspace/worktrees.ts";
import { git, gitProject } from "./git-helpers.ts";
import { load, tempProject } from "./helpers.ts";

const ROUTE: PlannedRoute = {
  id: "A",
  name: "Saudação",
  hardness: "fluorite",
  files: ["src/greet.ts"],
  tags: [],
  pitches: [{ title: "Trocar saudação", files: ["src/greet.ts"] }],
};
const PASS = 'node -e "process.exit(0)"';
const FAIL = "node -e \"console.log('boom'); process.exit(3)\"";

describe("shell", () => {
  it("runs through the platform shell and reports exit code and output", async () => {
    const ok = await runShell("node -e \"console.log('olá')\"", { cwd: tempProject(), timeoutMs: 10_000 });
    assert.equal(ok.code, 0);
    assert.match(ok.output, /olá/);
    const failed = await runShell(FAIL, { cwd: tempProject(), timeoutMs: 10_000 });
    assert.equal(failed.code, 3);
  });

  it("kills a command that runs past its timeout", async () => {
    const result = await runShell('node -e "setTimeout(() => {}, 60000)"', { cwd: tempProject(), timeoutMs: 300 });
    assert.equal(result.timedOut, true);
    assert.equal(result.code, 124);
  });
});

describe("local runner", () => {
  it("works in a worktree on its own branch, commits anchored pitches and leaves the project untouched", async () => {
    const root = gitProject({ "src/greet.ts": 'export const greet = () => "olá";\n', ".gitignore": "node_modules/\n" });
    writeFileSync(join(root, "leftover.txt"), "não versionado"); // uncommitted change in the user's working copy
    const worktreesDir = tempProject();
    const runner = new LocalRunner({ config: load(root), climbId: "20260929-1200-abcd", worktreesDir });

    const workspace = await runner.prepare(ROUTE);
    assert.equal(workspace.branch, "mohs/20260929-1200-abcd/A");
    assert.ok(workspace.path.startsWith(worktreesDir));
    assert.ok(!existsSync(join(workspace.path, "leftover.txt")), "worktree starts from the last commit");

    writeFileSync(join(workspace.path, "src/greet.ts"), 'export const greet = () => "oi";\n');
    const failed = await runner.anchor(ROUTE, 1, 1, [PASS, FAIL]);
    assert.equal(failed.ok, false);
    assert.match(failed.output ?? "", /código 3[\s\S]*boom/);

    const anchored = await runner.anchor(ROUTE, 1, 2, [PASS]);
    assert.equal(anchored.ok, true);
    assert.match(anchored.commit ?? "", /^[0-9a-f]{7,}$/);

    const delivery = await runner.finish(ROUTE);
    assert.deepEqual(delivery, { branch: "mohs/20260929-1200-abcd/A", commits: 1 });
    assert.ok(!existsSync(workspace.path), "worktree folder is removed; the branch keeps the work");
    assert.equal(git(root, "show", "mohs/20260929-1200-abcd/A:src/greet.ts"), 'export const greet = () => "oi";');
    assert.equal(readFileSync(join(root, "src/greet.ts"), "utf8"), 'export const greet = () => "olá";\n');
    assert.equal(git(root, "rev-parse", "--abbrev-ref", "HEAD"), "main");
  });

  it("links node_modules into the worktree without ever committing them", async () => {
    const root = gitProject({ "src/a.ts": "\n", ".gitignore": "node_modules/\n" });
    const deps = join(root, "node_modules", "lib");
    mkdirSync(deps, { recursive: true });
    writeFileSync(join(deps, "index.js"), "module.exports = 42;\n");
    const runner = new LocalRunner({ config: load(root), climbId: "c2", worktreesDir: tempProject() });

    const workspace = await runner.prepare(ROUTE);
    assert.equal(readFileSync(join(workspace.path, "node_modules", "lib", "index.js"), "utf8"), "module.exports = 42;\n");
    writeFileSync(join(workspace.path, "src/a.ts"), "export {};\n");
    await runner.anchor(ROUTE, 1, 1, []);
    const tracked = git(root, "ls-tree", "-r", "--name-only", "mohs/c2/A");
    assert.ok(!tracked.includes("node_modules"), tracked);
    await runner.finish(ROUTE);
  });

  it("commits when node_modules in the worktree is a real, ignored folder (a junction on Windows)", async () => {
    const root = gitProject({ "src/a.ts": "\n", ".gitignore": "node_modules/\n" });
    const runner = new LocalRunner({ config: load(root), climbId: "c5", worktreesDir: tempProject() });
    const workspace = await runner.prepare(ROUTE);
    // Uma pasta de verdade no lugar do link: é como o git vê a junction do Windows.
    mkdirSync(join(workspace.path, "node_modules", "lib"), { recursive: true });
    writeFileSync(join(workspace.path, "node_modules", "lib", "index.js"), "module.exports = 1;\n");
    writeFileSync(join(workspace.path, "src/a.ts"), "export {};\n");
    const anchored = await runner.anchor(ROUTE, 1, 1, []);
    assert.deepEqual(anchored.files, ["src/a.ts"]);
    await runner.finish(ROUTE);
  });

  it("uses a private repository in .mohs/git when the project has no git", async () => {
    const root = tempProject({ "src/greet.ts": "a\n" });
    const runner = new LocalRunner({ config: load(root), climbId: "c3", worktreesDir: tempProject() });
    const workspace = await runner.prepare(ROUTE);
    assert.ok(existsSync(join(root, ".mohs", "git")));
    assert.equal(
      git(root, "--git-dir", join(".mohs", "git"), "config", "core.autocrlf"),
      "false",
      "the MOHs' own repository never converts line endings",
    );
    assert.equal(readFileSync(join(workspace.path, "src/greet.ts"), "utf8"), "a\n");
    writeFileSync(join(workspace.path, "src/greet.ts"), "b\n");
    assert.equal((await runner.anchor(ROUTE, 1, 1, [PASS])).ok, true);
    assert.deepEqual(await runner.finish(ROUTE), { branch: "mohs/c3/A", commits: 1 });
    assert.ok(!existsSync(join(root, ".git")), "the user's project is never turned into a git repository");
  });
});

describe("local runner: seal and send", () => {
  const QUARTZ: PlannedRoute = { ...ROUTE, hardness: "quartz" };
  const SEAL = "node {file}";
  /** A sealed "test" is a script that exits 1 unless greet() says oi. */
  const sealedFile = (path: string, expected: string) => ({
    path,
    kind: "unit" as const,
    content: `import { greet } from "${"../".repeat(path.split("/").length - 1)}src/greet.js";\nif (greet() !== ${JSON.stringify(expected)}) { console.log("esperado ${expected}, obtido " + greet()); process.exit(1); }\n`,
  });

  function setup(seal: string | null = SEAL) {
    const root = gitProject({
      "package.json": '{ "type": "module" }\n',
      "src/greet.js": 'export const greet = () => "olá";\n',
      ".gitignore": ".mohs/climbs/\n",
      ...(seal ? { ".mohs/mohs.yaml": `commands:\n  seal: ${JSON.stringify(seal)}\n` } : {}),
    });
    const sealsDir = tempProject();
    const runner = new LocalRunner({ config: load(root), climbId: "c9", worktreesDir: tempProject(), sealsDir });
    return { root, sealsDir, runner };
  }

  it("gives the belayer a clean checkout and keeps only red seals", async () => {
    const { root, sealsDir, runner } = setup();
    assert.equal(
      runner.riggingProblem({ kind: "variation", files: 2, summary: "", languages: ["Go"] }),
      null,
      "commands.seal runs anything",
    );
    const bench = await runner.prepareSeal(QUARTZ);
    assert.ok(!existsSync(join(bench.path, ".mohs")), "the MOHs config is not the agent's business");
    assert.equal(readFileSync(join(bench.path, "src/greet.js"), "utf8"), 'export const greet = () => "olá";\n');

    const red = sealedFile("test/sealed/oi.js", "oi");
    const green = sealedFile("test/sealed/ola.js", "olá");
    const verdict = await runner.sealRed(QUARTZ, { files: [red, green], unit: 2, e2e: 0 });
    assert.deepEqual(verdict, { allRed: false, passing: ["test/sealed/ola.js"] });
    assert.ok(!existsSync(bench.path), "the belayer's checkout is gone once the seal is stored");
    assert.ok(
      readdirSync(sealsDir, { recursive: true }).some((f) => String(f).endsWith("oi.js")),
      "the seal is kept outside the project",
    );
    assert.ok(!readdirSync(root, { recursive: true }).some((f) => String(f).includes("sealed")), "nothing sealed lands in the project");

    assert.deepEqual(await runner.sealRed(QUARTZ, { files: [red], unit: 1, e2e: 0 }), { allRed: true, passing: [] });
    const helper = { path: "test/sealed/helper.js", kind: "support" as const, content: "export const alvo = 'oi';\n" };
    assert.deepEqual(
      await runner.sealRed(QUARTZ, { files: [red, helper], unit: 1, e2e: 0 }),
      { allRed: true, passing: [] },
      "a support file is written with the tests but never run as one",
    );
  });

  it("sends in a separate checkout, reports raw failures and never shows the seal to the climber", async () => {
    const { runner } = setup();
    await runner.sealRed(QUARTZ, { files: [sealedFile("test/sealed/oi.js", "oi")], unit: 1, e2e: 0 });
    const workspace = await runner.prepare(QUARTZ);

    writeFileSync(join(workspace.path, "src/greet.js"), 'export const greet = () => "oii";\n');
    await runner.anchor(QUARTZ, 1, 1, [PASS]);
    const fall = await runner.send(QUARTZ, 1, []);
    assert.equal(fall.ok, false);
    assert.equal(fall.failures[0].test, "test/sealed/oi.js");
    assert.match(fall.failures[0].output, /esperado oi, obtido oii/);
    assert.ok(!existsSync(join(workspace.path, "test/sealed")), "the climber's worktree never holds a sealed file");
    assert.match(await runner.diff(QUARTZ), /\+export const greet = \(\) => "oii"/);

    writeFileSync(join(workspace.path, "src/greet.js"), 'export const greet = () => "oi";\n');
    await runner.anchor(QUARTZ, 1, 2, [PASS]);
    assert.deepEqual(await runner.send(QUARTZ, 2, []), { ok: true, total: 1, failures: [] });
    assert.deepEqual(
      await runner.send(QUARTZ, 3, [FAIL]).then((r) => r.failures.map((f) => f.test)),
      [FAIL],
      "diamond adds the full suite",
    );
  });

  it("names what is missing when the project cannot run a sealed test", () => {
    const runner = new LocalRunner({ config: load(tempProject()), climbId: "c0" });
    const survey = (languages: string[]) => ({ kind: "variation" as const, files: 3, summary: "", languages });
    assert.match(runner.riggingProblem(survey(["Go"])) ?? "", /commands\.seal[\s\S]*node --test/);
    assert.equal(runner.riggingProblem(survey(["TypeScript", "CSS"])), null, "a Node project seals with node --test");
    assert.equal(runner.riggingProblem(survey(["Python"])), null);
  });

  it("runs sealed files by their extension when the project sets no commands.seal", async () => {
    const { runner } = setup(null);
    const red = sealedFile("test/sealed/oi.test.js", "oi");
    assert.deepEqual(await runner.sealRed(QUARTZ, { files: [red], unit: 1, e2e: 0 }), { allRed: true, passing: [] });
    const workspace = await runner.prepare(QUARTZ);
    writeFileSync(join(workspace.path, "src/greet.js"), 'export const greet = () => "oi";\n');
    await runner.anchor(QUARTZ, 1, 1, [PASS]);
    assert.deepEqual(await runner.send(QUARTZ, 1, []), { ok: true, total: 1, failures: [] }, "node --test runs a plain script too");
  });
});

describe("dependencies of a checkout", () => {
  it("finds the node_modules of the root, one level down and every workspace package", () => {
    const root = tempProject({
      "package.json": JSON.stringify({ workspaces: ["packages/*", "tools/lint"] }),
      "node_modules/a/index.js": "",
      "packages/web/node_modules/b/index.js": "",
      "packages/api/package.json": "{}",
      "tools/lint/node_modules/c/index.js": "",
      "scripts/node_modules/d/index.js": "",
    });
    assert.deepEqual(dependencyFolders(root).sort(), [
      "node_modules",
      join("packages", "web", "node_modules"),
      join("scripts", "node_modules"),
      join("tools", "lint", "node_modules"),
    ]);
  });

  it("points a workspace package at the checkout's own copy, and third-party ones at the root", () => {
    const root = tempProject({
      "package.json": JSON.stringify({ workspaces: ["packages/*"] }),
      "packages/plugin/index.js": "module.exports = 'raiz';\n",
      "node_modules/lodash/index.js": "",
      "node_modules/@scope/tool/index.js": "",
      "node_modules/.yarn-integrity": "{}",
    });
    symlinkSync(join("..", "packages", "plugin"), join(root, "node_modules", "plugin"));
    const checkout = tempProject({ "packages/plugin/index.js": "module.exports = 'checkout';\n" });
    linkDependencies(root, checkout);
    assert.equal(realpathSync(join(checkout, "node_modules", "plugin")), realpathSync(join(checkout, "packages", "plugin")));
    assert.equal(realpathSync(join(checkout, "node_modules", "lodash")), realpathSync(join(root, "node_modules", "lodash")));
    assert.equal(
      realpathSync(join(checkout, "node_modules", "@scope", "tool")),
      realpathSync(join(root, "node_modules", "@scope", "tool")),
    );
    assert.ok(existsSync(join(checkout, "node_modules", ".yarn-integrity")));

    const plain = tempProject({ "node_modules/lodash/index.js": "" });
    const other = tempProject();
    linkDependencies(plain, other);
    assert.ok(lstatSync(join(other, "node_modules")).isSymbolicLink(), "with no workspace links, node_modules is linked whole");
  });

  it("runs a scoped check only for the workspace packages the pitch touched", async () => {
    const root = gitProject({
      "package.json": JSON.stringify({ workspaces: ["packages/*"] }),
      "packages/a/index.js": "",
      "packages/b/index.js": "",
      ".gitignore": ".mohs/\n",
    });
    const route = { ...ROUTE, files: ["packages/a/index.js"] };
    const runner = new LocalRunner({ config: load(root), climbId: "c9", worktreesDir: tempProject() });
    const workspace = await runner.prepare(route);
    writeFileSync(join(workspace.path, "packages/b/index.js"), "export {};\n");
    const echo = 'node -e "process.exit(0)" --';
    const result = await runner.anchor(route, 1, 1, [`${echo} {packages}`, `${echo} {filters}`]);
    assert.deepEqual(result.checks, [`${echo} packages/b`, `${echo} --filter=./packages/b`]);
    const idle = await runner.anchor(route, 1, 1, [`${echo} {packages}`]);
    assert.deepEqual(idle.checks, [], "nothing changed in any package: nothing to run");
    await runner.finish(route);
  });
});
