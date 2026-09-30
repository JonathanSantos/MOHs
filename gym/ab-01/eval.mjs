// Avalia cada run do A/B: suíte escondida, testes do projeto, diff e, no braço MOHs, o log do climb.
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

const AB = new URL(".", import.meta.url).pathname;
// A suíte escondida fica fora do repositório (docs/VALIDATION.md): npm run validate -- hidden list
const HIDDEN = join(process.env.MOHS_HOME ?? join(homedir(), ".mohs"), "validation", "hidden", "tarefas-ab01");
const usage = JSON.parse(readFileSync(join(AB, "usage.json"), "utf8"));
const sh = (cmd, args, cwd) => {
  try {
    const env = { ...process.env };
    delete env.NODE_TEST_CONTEXT;
    return execFileSync(cmd, args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], env });
  } catch (error) {
    return `${error.stdout ?? ""}${error.stderr ?? ""}`;
  }
};
const count = (out, key) => Number(new RegExp(`ℹ ${key} (\\d+)`).exec(out)?.[1] ?? 0);
const failures = (out) => [...new Set([...out.matchAll(/^\s*✖ (.+?) \(\d/gm)].map((m) => m[1]).filter((n) => !n.includes(".test.js")))];

function testRun(dir, args) {
  const out = sh("node", ["--test", "--test-reporter=spec", ...args], dir);
  return { pass: count(out, "pass"), fail: count(out, "fail"), failing: failures(out) };
}

function delivered(run, arm) {
  const dir = mkdtempSync(join(tmpdir(), "ab-eval-"));
  if (arm === "direto") {
    cpSync(run, dir, { recursive: true, filter: (src) => !src.includes("/.git") });
    sh("git", ["add", "-A"], run);
    return { dir, numstat: sh("git", ["diff", "--cached", "--numstat"], run) };
  }
  const branch = sh("git", ["branch", "--list", "mohs/*", "--format=%(refname:short)"], run).trim().split("\n")[0];
  if (!branch) return { dir: null, numstat: "" };
  execFileSync("sh", ["-c", `git archive ${branch} | tar -x -C ${dir}`], { cwd: run });
  return {
    dir,
    branch,
    numstat: sh("git", ["diff", "--numstat", `main..${branch}`], run),
    mainClean: sh("git", ["status", "--porcelain"], run).trim() === "",
  };
}

function climbLog(run) {
  const climbs = join(run, ".mohs", "climbs");
  if (!existsSync(climbs)) return null;
  const [id] = readdirSync(climbs);
  const events = readFileSync(join(climbs, id, "events.jsonl"), "utf8")
    .trim()
    .split("\n")
    .map((l) => JSON.parse(l));
  const of = (type) => events.filter((e) => e.type === type);
  const plan = of("scout.hardness")[0]?.data;
  const line = of("line.drafted").at(-1)?.data.text ?? "";
  const friction = {};
  for (const e of of("friction")) friction[e.data.kind] = (friction[e.data.kind] ?? 0) + 1;
  const start = Date.parse(events[0].ts);
  const end = Date.parse(events.at(-1).ts);
  return {
    id,
    state: of("climb.done").length ? "done" : of("climb.aborted").length ? `aborted: ${of("climb.aborted")[0].data.reason}` : "incompleto",
    hardness: plan?.hardness,
    pitches: plan?.routes.reduce((n, r) => n + r.pitches.length, 0),
    retries: of("pitch.retry").length,
    friction,
    o2: events.reduce((n, e) => n + (e.o2 ?? 0), 0),
    lineLines: line.split("\n").length,
    decisions: (/##[^\n]*[Dd]ecis[^\n]*\n([\s\S]*?)(\n## |$)/.exec(line)?.[1].match(/^\s*[-*\d]/gm) ?? []).length,
    tasks: readdirSync(join(climbs, id, "tasks")).filter((f) => /^T\d+\.json$/.test(f)).length,
    seconds: Math.round((end - start) / 1000),
  };
}

const results = [];
for (const name of readdirSync(join(AB, "runs")).sort()) {
  const [task, arm] = name.split("-");
  const run = join(AB, "runs", name);
  const result = { name, task, arm, usage: usage[name] ?? null };
  const out = delivered(run, arm);
  if (out.dir) {
    result.projectTests = testRun(out.dir, []);
    mkdirSync(join(out.dir, "acceptance"));
    cpSync(join(HIDDEN, `${task}.test.js`), join(out.dir, "acceptance", `${task}.test.js`));
    result.acceptance = testRun(out.dir, [`acceptance/${task}.test.js`]);
    const files = out.numstat
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((l) => l.split("\t"));
    result.diff = {
      files: files.map((f) => f[2]),
      added: files.reduce((n, f) => n + Number(f[0]), 0),
      removed: files.reduce((n, f) => n + Number(f[1]), 0),
    };
    result.branch = out.branch;
    result.mainClean = out.mainClean;
    rmSync(out.dir, { recursive: true, force: true });
  }
  if (arm === "mohs") result.climb = climbLog(run);
  results.push(result);
}
writeFileSync(join(AB, "results.json"), JSON.stringify(results, null, 2));
console.log(
  results
    .map(
      (r) =>
        `${r.name.padEnd(18)} aceite ${r.acceptance ? `${r.acceptance.pass}/${r.acceptance.pass + r.acceptance.fail}` : "—"} · projeto ${r.projectTests ? `${r.projectTests.pass}/${r.projectTests.pass + r.projectTests.fail}` : "—"} · tokens ${r.usage?.tokens ?? "?"} · ${r.climb?.state ?? ""}`,
    )
    .join("\n"),
);
