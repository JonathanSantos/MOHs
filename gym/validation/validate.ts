// Validações do MOHs: um pedido, vários braços (com e sem harness), cada um num subagente e numa pasta isolada.
// O protocolo está em docs/VALIDATION.md. Uso: npm run validate -- <comando> … (sem argumentos, mostra a ajuda).
import { execFileSync } from "node:child_process";
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { basename, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { ARMS, DEFAULT_ARMS } from "./arms.ts";
import { renderValidationReport } from "./report.ts";

const REPO = fileURLToPath(new URL("../../", import.meta.url));
export const VALIDATION_DIR = ".validation";
/** What of the MOHs a run freezes, so later changes to the repository never change a run in progress. */
const MOHS_PARTS = ["bin", "src", "core", "guidebooks", "package.json"];
const IDENTITY = ["-c", "user.name=mohs-validation", "-c", "user.email=validation@mohs.local"];

/** Reusable starting projects, versioned with the MOHs. */
export const TEMPLATES_DIR = join(REPO, "gym", "templates");

/** Hidden suites live outside the repository, so no arm running inside it can come across one. */
export function hiddenStore(): string {
  return join(process.env.MOHS_HOME ?? join(homedir(), ".mohs"), "validation", "hidden");
}

export interface RunArm {
  /** The folder: the arm spec (`mohs`, `mohs@a4f285f`), with -r2, -r3… for repetitions. */
  name: string;
  arm: string;
  /** The MOHs version this arm runs, when not the working tree of the repository. */
  ref?: string;
  dir: string;
  /** The frozen MOHs for this arm, with its own MOHS_HOME. */
  mohs?: string;
}

export interface RunInfo {
  name: string;
  dir: string;
  request: string;
  template: string;
  createdAt: string;
  /** The commit of each frozen MOHs: `working` is the repository as it was, uncommitted changes included. */
  mohs: Record<string, { commit: string; dirty: boolean }>;
  arms: RunArm[];
}

export interface RunSpec {
  keywords: readonly string[];
  request: string;
  /** A template name in gym/templates, or a folder. */
  template: string;
  /** Arm ids, `id@ref` to run a MOHs arm on another version (`mohs@a4f285f`). */
  arms?: readonly string[];
  reps?: number;
  /** Where `.validation/` lives; the repository by default. */
  base?: string;
  now?: Date;
}

/** `botao-contador-acessivel-20260930-1415`: three keywords, then the local date and time. */
export function runName(keywords: readonly string[], now: Date): string {
  if (keywords.length !== 3) throw new Error("use três palavras-chave");
  const slug = (word: string) =>
    word
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");
  const pad = (n: number) => String(n).padStart(2, "0");
  const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}`;
  return `${keywords.map(slug).join("-")}-${stamp}`;
}

export function resolveTemplate(template: string): string {
  const named = join(TEMPLATES_DIR, template);
  if (existsSync(named)) return named;
  if (existsSync(template)) return resolve(template);
  throw new Error(`template não encontrado: ${template} (nem em gym/templates, nem como pasta)`);
}

export function createRun(spec: RunSpec): RunInfo {
  const specs = (spec.arms ?? DEFAULT_ARMS).map((text) => {
    const [arm, ref] = text.split("@");
    if (!ARMS[arm]) throw new Error(`braço desconhecido: ${arm}. Braços: ${Object.keys(ARMS).join(", ")}`);
    if (ref && !ARMS[arm].usesMohs) throw new Error(`${arm} não usa o MOHs, então não tem versão (@${ref})`);
    return { text, arm, ref };
  });
  const template = resolveTemplate(spec.template);
  const name = runName(spec.keywords, spec.now ?? new Date());
  const dir = join(resolve(spec.base ?? REPO), VALIDATION_DIR, name);
  if (existsSync(dir)) throw new Error(`a validação ${name} já existe`);
  mkdirSync(dir, { recursive: true });

  const copyProject = (to: string) => cpSync(template, to, { recursive: true, filter: (src) => !/[\\/](\.git|node_modules)$/.test(src) });
  copyProject(join(dir, "template"));
  const versions: RunInfo["mohs"] = {};
  for (const ref of new Set(specs.filter(({ arm }) => ARMS[arm].usesMohs).map(({ ref }) => ref ?? "working"))) {
    versions[ref] = freezeMohs(dir, ref);
  }

  const runArms: RunArm[] = [];
  for (const { text, arm, ref } of specs) {
    for (let rep = 1; rep <= (spec.reps ?? 1); rep++) {
      const armName = rep === 1 ? text : `${text}-r${rep}`;
      const armDir = join(dir, armName);
      copyProject(armDir);
      git(armDir, "init", "-q", "-b", "main");
      git(armDir, "add", "-A");
      git(armDir, ...IDENTITY, "commit", "-q", "--allow-empty", "-m", "base da validação");
      const runArm: RunArm = { name: armName, arm, ref, dir: armDir };
      if (ARMS[arm].usesMohs) {
        const frozen = mohsFolder(dir, ref);
        runArm.mohs = writeWrapper(dir, armName, frozen);
        execFileSync(process.execPath, [join(frozen, "bin", "mohs.js"), "init", "--cwd", armDir], {
          env: { ...process.env, MOHS_HOME: join(dir, "_mohs-home", armName) },
          stdio: "ignore",
        });
        git(armDir, "add", "-A");
        git(armDir, ...IDENTITY, "commit", "-q", "-m", "mohs init");
      }
      runArms.push(runArm);
    }
  }

  const info: RunInfo = {
    name,
    dir,
    request: spec.request,
    template: relative(REPO, template) || template,
    createdAt: (spec.now ?? new Date()).toISOString(),
    mohs: versions,
    arms: runArms,
  };
  writeFileSync(join(dir, "run.json"), JSON.stringify(info, null, 2));
  writePrompts(info);
  return info;
}

function mohsFolder(dir: string, ref: string | undefined): string {
  return join(dir, ref ? `_mohs@${ref}` : "_mohs");
}

/**
 * A copy of the MOHs this run uses, with the repository's dependencies linked: the working tree as it is (uncommitted
 * changes included), or a commit, to compare versions of the harness on the same request.
 */
function freezeMohs(dir: string, ref: string): { commit: string; dirty: boolean } {
  const to = mohsFolder(dir, ref === "working" ? undefined : ref);
  mkdirSync(to, { recursive: true });
  if (ref === "working") {
    for (const part of MOHS_PARTS) cpSync(join(REPO, part), join(to, part), { recursive: true });
  } else {
    const archive = join(to, ".mohs.tar");
    git(REPO, "archive", "--format=tar", "-o", archive, ref, ...MOHS_PARTS.filter((part) => existsSync(join(REPO, part))));
    execFileSync("tar", ["-xf", archive, "-C", to]);
    rmSync(archive);
  }
  symlinkSync(join(REPO, "node_modules"), join(to, "node_modules"), "junction");
  const commit = git(REPO, "rev-parse", "--short", ref === "working" ? "HEAD" : ref).trim();
  return { commit, dirty: ref === "working" && git(REPO, "status", "--porcelain").trim() !== "" };
}

/** `_bin/mohs-<arm>`: the arm's frozen MOHs with its own MOHS_HOME, and the commands it prints pointing back to it. */
function writeWrapper(dir: string, armName: string, frozen: string): string {
  const bin = join(dir, "_bin");
  mkdirSync(bin, { recursive: true });
  const entry = join(frozen, "bin", "mohs.js");
  const home = join(dir, "_mohs-home", armName);
  const sh = join(bin, `mohs-${armName}`);
  writeFileSync(sh, `#!/bin/sh\nMOHS_HOME="${home}" MOHS_BIN="${sh}" exec node "${entry}" "$@"\n`);
  chmodSync(sh, 0o755);
  writeFileSync(`${sh}.cmd`, `@echo off\r\nset "MOHS_HOME=${home}"\r\nset "MOHS_BIN=${sh}.cmd"\r\nnode "${entry}" %*\r\n`);
  return process.platform === "win32" ? `${sh}.cmd` : sh;
}

/** One prompt per arm, exactly as the subagent receives it, and a README for whoever reads the run later. */
function writePrompts(info: RunInfo): void {
  const prompts = join(info.dir, "_prompts");
  mkdirSync(prompts, { recursive: true });
  for (const arm of info.arms) {
    const skill = join(mohsFolder(info.dir, arm.ref), "core", "agent", "SKILL.md");
    const text = ARMS[arm.arm].prompt({ request: info.request, dir: arm.dir, mohs: arm.mohs ?? "", skill });
    writeFileSync(join(prompts, `${arm.name}.md`), `${text}\n`);
  }
  const rows = info.arms.map(
    (arm) => `| ${arm.name} | ${ARMS[arm.arm].label}${arm.ref ? ` (MOHs ${arm.ref})` : ""} | ${ARMS[arm.arm].measures} |`,
  );
  const versions = Object.entries(info.mohs).map(
    ([ref, v]) =>
      `\`${ref === "working" ? "_mohs" : `_mohs@${ref}`}\` (commit ${v.commit}${v.dirty ? ", com mudanças não commitadas" : ""})`,
  );
  writeFileSync(
    join(info.dir, "README.md"),
    [
      `# ${info.name}`,
      "",
      `Pedido: ${info.request}`,
      "",
      `Template: \`${info.template}\`. ${versions.length ? `MOHs congelado em ${versions.join(", ")}.` : ""}`,
      "",
      "| Pasta | Braço | O que mede |",
      "| --- | --- | --- |",
      ...rows,
      "",
      "Protocolo: docs/VALIDATION.md no repositório do MOHs.",
      "",
    ].join("\n"),
  );
}

// ── o que acontece durante a validação ─────────────────────────────────────

export interface Usage {
  tokens: number;
  tools: number;
  ms: number;
  note?: string;
}

/**
 * One part of what an arm cost: a subagent run, a resume after a human answer, a nested subagent the orchestrator
 * reported. Parts add up; the total is what the arm cost.
 */
export function recordUsage(dir: string, armName: string, usage: Usage): void {
  appendJson<Usage>(join(dir, "_usage.json"), armName, usage);
}

/** What the human (whoever runs the validation) decided in an arm: a signature, a rescue, an answer. */
export function recordDecision(dir: string, armName: string, text: string): void {
  appendJson(join(dir, "_decisions.json"), armName, { at: new Date().toISOString(), text });
}

/** The subagent's final report, kept for the comparison page and as friction for the harness. */
export function saveReport(dir: string, armName: string, text: string): void {
  mkdirSync(join(dir, "_relatos"), { recursive: true });
  writeFileSync(join(dir, "_relatos", `${armName}.md`), text.endsWith("\n") ? text : `${text}\n`);
}

export function totalUsage(parts: readonly Usage[] | undefined): Usage | undefined {
  if (!parts?.length) return undefined;
  return parts.reduce((sum, part) => ({ tokens: sum.tokens + part.tokens, tools: sum.tools + part.tools, ms: sum.ms + part.ms }), {
    tokens: 0,
    tools: 0,
    ms: 0,
  });
}

function appendJson<T>(file: string, key: string, value: T): void {
  const all = readJson<Record<string, T[]>>(file) ?? {};
  (all[key] ??= []).push(value);
  writeFileSync(file, JSON.stringify(all, null, 2));
}

function readJson<T>(file: string): T | null {
  return existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")) as T) : null;
}

// ── suítes escondidas ──────────────────────────────────────────────────────

/** Keeps a hidden suite in the store under a name, for this run and for repeating it later. */
export function saveHidden(name: string, from: string): string {
  const to = join(hiddenStore(), name);
  cpSync(resolve(from), to, { recursive: true });
  return to;
}

export function resolveHidden(hidden: string): string {
  const stored = join(hiddenStore(), hidden);
  if (existsSync(stored)) return stored;
  if (existsSync(hidden)) return resolve(hidden);
  throw new Error(`suíte escondida não encontrada: ${hidden} (nem em ${hiddenStore()}, nem como pasta)`);
}

// ── avaliação ──────────────────────────────────────────────────────────────

export interface ArmResult {
  name: string;
  arm: string;
  ref?: string;
  delivered: string;
  hidden: { pass: number; total: number; failing: string[] };
  project: { pass: number; fail: number } | null;
  diff: { files: number; added: number; removed: number };
  workingCopyIntact?: boolean;
  usage?: Usage;
  usageParts: number;
  climb?: ClimbMetrics | null;
}

/**
 * Judges every arm by the same hidden suite (kept out of the run until now), plus the project's own tests, the diff,
 * the subagent's usage and, for MOHs arms, what the climb log says. Writes results.json.
 */
export function evaluateRun(dir: string, hidden: string): ArmResult[] {
  const info = readJson<RunInfo>(join(dir, "run.json"));
  if (!info) throw new Error(`não há run.json em ${dir}`);
  cpSync(resolveHidden(hidden), join(dir, "_hidden"), { recursive: true });
  const usage = readJson<Record<string, Usage[]>>(join(dir, "_usage.json")) ?? {};
  const results = info.arms.map((arm) => evaluateArm(arm, join(dir, "_hidden"), usage[arm.name]));
  writeFileSync(join(dir, "results.json"), JSON.stringify({ run: info.name, request: info.request, arms: results }, null, 2));
  return results;
}

function evaluateArm(arm: RunArm, hidden: string, usage: Usage[] | undefined): ArmResult {
  const out = mkdtempSync(join(tmpdir(), "mohs-validation-"));
  const branch = arm.mohs ? deliveryBranch(arm.dir) : undefined;
  if (arm.mohs && branch) {
    // Sem shell: git archive num arquivo e tar para extrair, igual no Windows, macOS e Linux.
    const archive = join(out, ".delivery.tar");
    git(arm.dir, "archive", "--format=tar", "-o", archive, branch);
    execFileSync("tar", ["-xf", archive, "-C", out]);
    rmSync(archive);
  } else if (!arm.mohs) cpSync(arm.dir, out, { recursive: true, filter: (src) => !/[\\/]\.git$/.test(src) });

  const numstat = branch ? git(arm.dir, "diff", "--numstat", `main..${branch}`) : arm.mohs ? "" : worktreeNumstat(arm.dir);
  const diff = numstat
    .trim()
    .split("\n")
    .filter(Boolean)
    .reduce(
      (sum, line) => {
        const [added, removed] = line.split("\t").map(Number);
        return { files: sum.files + 1, added: sum.added + (added || 0), removed: sum.removed + (removed || 0) };
      },
      { files: 0, added: 0, removed: 0 },
    );
  const nothing = Boolean(arm.mohs && !branch);
  // A suíte do projeto roda antes de a escondida entrar na pasta: senão ela também a descobriria.
  const project = nothing ? null : projectSuite(out);
  return {
    name: arm.name,
    arm: arm.arm,
    ref: arm.ref,
    delivered: branch ?? (arm.mohs ? "nada entregue" : "working tree"),
    hidden: nothing ? { pass: 0, total: countFiles(hidden), failing: ["sem entrega"] } : hiddenSuite(out, hidden),
    project,
    diff,
    workingCopyIntact: arm.mohs ? git(arm.dir, "status", "--porcelain").trim() === "" : undefined,
    usage: totalUsage(usage),
    usageParts: usage?.length ?? 0,
    climb: arm.mohs ? climbMetrics(arm.dir) : undefined,
  };
}

/** The delivery branch of the latest climb, or its only route's branch. */
function deliveryBranch(dir: string): string | undefined {
  const branches = git(dir, "branch", "--list", "mohs/*", "--format=%(refname:short)").trim().split("\n").filter(Boolean).sort();
  return branches.find((b) => b.endsWith("/entrega")) ?? branches.at(-1);
}

function worktreeNumstat(dir: string): string {
  git(dir, "add", "-A");
  return git(dir, "diff", "--cached", "--numstat");
}

function hiddenSuite(out: string, hidden: string): ArmResult["hidden"] {
  const target = join(out, "acceptance");
  cpSync(hidden, target, { recursive: true });
  const files = readdirSync(target, { recursive: true })
    .map(String)
    .filter((file) => /\.(test|spec)\.(m?js|ts)$/.test(file))
    .map((file) => join("acceptance", file));
  const output = run(process.execPath, ["--test", "--test-reporter=spec", ...files], out);
  return { pass: count(output, "pass"), total: count(output, "tests"), failing: failing(output) };
}

function projectSuite(out: string): ArmResult["project"] {
  const pkg = readJson<{ scripts?: Record<string, string> }>(join(out, "package.json"));
  if (!pkg?.scripts?.test) return null;
  const output = run("npm", ["test", "--silent"], out);
  return { pass: count(output, "pass"), fail: count(output, "fail") };
}

export interface ClimbMetrics {
  id: string;
  state: string;
  hardness?: string;
  routes: number;
  tasks: number;
  falls: number;
  disputes: number;
  retries: number;
  evidence: string[];
  humanMinutes: number;
  o2: number;
  lineLines: number;
  decisions: number;
  seconds: number;
}

/** What the latest climb's log says: flow, human waits, ceremony and evidence. */
function climbMetrics(dir: string): ClimbMetrics | null {
  const climbs = join(dir, ".mohs", "climbs");
  if (!existsSync(climbs)) return null;
  const id = readdirSync(climbs).sort().at(-1);
  if (!id) return null;
  const events = readFileSync(join(climbs, id, "events.jsonl"), "utf8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line) as { type: string; ts: string; o2?: number; data: Record<string, unknown> });
  const of = (type: string) => events.filter((event) => event.type === type);
  const at = (event: { ts: string } | undefined) => (event ? Date.parse(event.ts) : 0);
  const waits = [
    ...pairs(of("line.drafted"), of("line.signed")),
    ...pairs(of("signature.requested"), of("signature.given")),
    ...pairs(of("rescue.called"), of("rescue.resolved")),
  ];
  const plan = of("scout.hardness")[0]?.data as { hardness?: string; routes?: unknown[] } | undefined;
  const line = (of("line.drafted").at(-1)?.data.text as string | undefined) ?? "";
  const ended = ["climb.done", "climb.aborted", "climb.escalated"].find((type) => of(type).length);
  return {
    id,
    state: ended ? ended.replace("climb.", "") : "incompleto",
    hardness: plan?.hardness,
    routes: plan?.routes?.length ?? 0,
    tasks: readdirSync(join(climbs, id, "tasks")).filter((file) => /^T\d+\.json$/.test(file)).length,
    falls: of("send.fall").length,
    disputes: of("seal.disputed").length,
    retries: of("pitch.retry").length,
    evidence: of("route.summit").flatMap((event) => {
      const evidence = event.data.evidence as { grade: string } | undefined;
      return evidence ? [evidence.grade] : [];
    }),
    humanMinutes: Math.round(waits.reduce((sum, [from, to]) => sum + (at(to) - at(from)), 0) / 600) / 100,
    o2: events.reduce((sum, event) => sum + (event.o2 ?? 0), 0),
    lineLines: line ? line.split("\n").length : 0,
    decisions: of("decisions.taken").reduce((sum, event) => sum + ((event.data.decisions as unknown[]) ?? []).length, 0),
    seconds: Math.round((at(events.at(-1)) - at(events[0])) / 1000),
  };
}

/** Each opening event with the first closing one after it. */
function pairs<T extends { ts: string }>(opens: T[], closes: T[]): [T, T][] {
  return opens.flatMap((open) => {
    const close = closes.find((candidate) => Date.parse(candidate.ts) >= Date.parse(open.ts));
    return close ? [[open, close] as [T, T]] : [];
  });
}

// ── relatório ──────────────────────────────────────────────────────────────

/** The comparison page of an evaluated run: `<run>/index.html`, self-contained. */
export function writeReport(dir: string): string {
  const info = readJson<RunInfo>(join(dir, "run.json"));
  const results = readJson<{ arms: ArmResult[] }>(join(dir, "results.json"));
  if (!info || !results) throw new Error("avalie a validação antes do relatório (eval)");
  const relatos = Object.fromEntries(
    info.arms.flatMap((arm) => {
      const file = join(dir, "_relatos", `${arm.name}.md`);
      return existsSync(file) ? [[arm.name, readFileSync(file, "utf8")]] : [];
    }),
  );
  const html = renderValidationReport({
    info,
    results: results.arms,
    decisions: readJson<Record<string, { at: string; text: string }[]>>(join(dir, "_decisions.json")) ?? {},
    relatos,
  });
  const file = join(dir, "index.html");
  writeFileSync(file, html);
  return file;
}

// ── plumbing ───────────────────────────────────────────────────────────────

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

/** Output of a command that may fail (a failing suite is a result, not an error). NODE_TEST_CONTEXT is dropped. */
function run(command: string, args: string[], cwd: string): string {
  const { NODE_TEST_CONTEXT: _inherited, ...env } = process.env;
  try {
    return execFileSync(command, args, {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      env,
      shell: process.platform === "win32",
    });
  } catch (error) {
    const failed = error as { stdout?: string; stderr?: string };
    return `${failed.stdout ?? ""}${failed.stderr ?? ""}`;
  }
}

/** node:test totals, from the spec reporter (ℹ) or TAP (#). */
const count = (output: string, key: string) => Number(new RegExp(`^[ℹ#] ${key} (\\d+)`, "m").exec(output)?.[1] ?? 0);
const failing = (output: string) =>
  [...new Set([...output.matchAll(/^\s*✖ (.+?) \(\d/gm)].map((match) => match[1]))].filter((name) => !/\.(test|spec)\./.test(name));
const countFiles = (dir: string) => readdirSync(dir, { recursive: true }).filter((file) => /\.(test|spec)\./.test(String(file))).length;

// ── CLI ────────────────────────────────────────────────────────────────────

const HELP = `Validações do MOHs (protocolo em docs/VALIDATION.md)

  new <palavra> <palavra> <palavra> --request "<pedido>" --template <nome|pasta> [--arms direto,placebo,mohs-fix,mohs] [--reps N]
  hidden save <nome> <pasta>      guarda uma suíte escondida fora do repositório
  hidden list                     lista as suítes guardadas
  usage <validação> <braço> --tokens N --tools N --ms N [--note "…"]   soma uma parcela do uso
  decision <validação> <braço> "<o que o humano decidiu>"
  relato <validação> <braço> --file <arquivo>   guarda o relato final do subagente
  eval <validação> --hidden <nome|pasta>
  report <validação>              gera <validação>/index.html
  list                            mostra as validações

Braços: ${Object.keys(ARMS).join(", ")} (use braço@commit para outra versão do MOHs, ex.: mohs@a4f285f).
Templates em gym/templates: ${existsSync(TEMPLATES_DIR) ? readdirSync(TEMPLATES_DIR).join(", ") : "nenhum"}.`;

function printResults(results: ArmResult[]): void {
  const seconds = (ms?: number) => (ms ? `${Math.round(ms / 1000)} s` : "—");
  const kilo = (n?: number) => (n ? `${Math.round(n / 1000)}k` : "—");
  console.log("braço | oculta | projeto | arquivos (+/−) | tokens | ferramentas | tempo | humano | climb");
  for (const r of results) {
    const project = r.project ? `${r.project.pass}/${r.project.pass + r.project.fail}` : "—";
    const climb = r.climb
      ? `${r.climb.state} · ${r.climb.hardness ?? "?"} · ${r.climb.tasks} tarefas · evidência ${r.climb.evidence.join(", ") || "—"}`
      : "—";
    const human = r.climb ? `${r.climb.humanMinutes} min` : "—";
    console.log(
      `${r.name} | ${r.hidden.pass}/${r.hidden.total} | ${project} | ${r.diff.files} (+${r.diff.added}/−${r.diff.removed}) | ${kilo(r.usage?.tokens)} | ${r.usage?.tools ?? "—"} | ${seconds(r.usage?.ms)} | ${human} | ${climb}`,
    );
  }
}

function main(argv: string[]): number {
  const [command, ...rest] = argv;
  const { values, positionals } = parseArgs({
    args: rest,
    allowPositionals: true,
    options: {
      request: { type: "string" },
      template: { type: "string" },
      arms: { type: "string" },
      reps: { type: "string" },
      hidden: { type: "string" },
      tokens: { type: "string" },
      tools: { type: "string" },
      ms: { type: "string" },
      note: { type: "string" },
      file: { type: "string" },
    },
  });
  const runDir = (name: string | undefined) => {
    if (!name) throw new Error("diga qual validação (o nome da pasta em .validation/)");
    return existsSync(name) ? resolve(name) : join(REPO, VALIDATION_DIR, name);
  };

  switch (command) {
    case "new": {
      if (!values.request || !values.template) throw new Error(HELP);
      const info = createRun({
        keywords: positionals,
        request: values.request,
        template: values.template,
        arms: values.arms?.split(",").map((arm) => arm.trim()),
        reps: values.reps ? Number(values.reps) : 1,
      });
      console.log(`validação ${info.name}\n  ${relative(process.cwd(), info.dir)}`);
      for (const arm of info.arms) console.log(`  ${arm.name.padEnd(16)} ${ARMS[arm.arm].label} · prompt em _prompts/${arm.name}.md`);
      return 0;
    }
    case "hidden": {
      const [action, name, from] = positionals;
      if (action === "save" && name && from) console.log(`suíte guardada em ${saveHidden(name, from)}`);
      else if (action === "list") for (const suite of existsSync(hiddenStore()) ? readdirSync(hiddenStore()) : []) console.log(suite);
      else throw new Error(HELP);
      return 0;
    }
    case "usage": {
      const [name, arm] = positionals;
      recordUsage(runDir(name), arm, {
        tokens: Number(values.tokens),
        tools: Number(values.tools),
        ms: Number(values.ms),
        note: values.note,
      });
      return 0;
    }
    case "decision": {
      const [name, arm, ...text] = positionals;
      recordDecision(runDir(name), arm, text.join(" "));
      return 0;
    }
    case "relato": {
      const [name, arm] = positionals;
      if (!values.file) throw new Error(HELP);
      saveReport(runDir(name), arm, readFileSync(values.file, "utf8"));
      return 0;
    }
    case "eval": {
      if (!values.hidden) throw new Error(HELP);
      printResults(evaluateRun(runDir(positionals[0]), values.hidden));
      return 0;
    }
    case "report":
      console.log(`relatório em ${writeReport(runDir(positionals[0]))}`);
      return 0;
    case "list": {
      const root = join(REPO, VALIDATION_DIR);
      for (const name of existsSync(root) ? readdirSync(root).sort() : []) {
        const info = readJson<RunInfo>(join(root, name, "run.json"));
        if (!info) continue;
        const evaluated = existsSync(join(root, name, "results.json")) ? "avaliada" : "sem avaliação";
        console.log(`${name} · ${info.arms.map((arm) => arm.name).join(", ")} · ${evaluated} · ${info.request}`);
      }
      return 0;
    }
    default:
      console.log(HELP);
      return command ? 1 : 0;
  }
}

if (basename(process.argv[1] ?? "") === "validate.ts") {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (error) {
    console.error((error as Error).message);
    process.exitCode = 1;
  }
}
