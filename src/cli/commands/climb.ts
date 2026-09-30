import { spawn } from "node:child_process";
import { closeSync, mkdirSync, openSync } from "node:fs";
import { join } from "node:path";
import { Basecamp } from "../../basecamp/basecamp.ts";
import { FileDesk } from "../../basecamp/desk.ts";
import { climbDir, EVENTS_FILE, readEvents } from "../../basecamp/event-log.ts";
import { isClimbMode, STAGE_SETS } from "../../basecamp/stages/index.ts";
import { basecampAlive } from "../../basecamp/presence.ts";
import { resumePoint, resumeProblem, type ResumePoint } from "../../basecamp/resume.ts";
import { newClimbId } from "../../basecamp/session.ts";
import { loadConfig } from "../../config/load.ts";
import { isHardness, isRescueOption, RESCUE_OPTIONS } from "../../domain/types.ts";
import { DEFAULT_SCENARIO } from "../../drivers/fake/index.ts";
import { SCENARIOS } from "../../drivers/fake/scenarios/index.ts";
import { startLookout } from "../../lookout/server.ts";
import { waitForSituation } from "../../tasks/situation.ts";
import { keepAlive, sleep } from "../../util/runtime.ts";
import { WAIT_FLAG, waitMs } from "../climb-dir.ts";
import { defineCommand } from "../command.ts";
import { CREW_DRIVERS, DEFAULT_CREW } from "../crews.ts";
import { describeEvent } from "../event-lines.ts";
import { CLI_ENTRY, mohsBin } from "../invocation.ts";
import { lookoutPort } from "../options.ts";
import { printConfigErrors } from "../reports/doctor.ts";
import { reportSituation } from "../reports/situation.ts";
import { fail, ink, print } from "../terminal.ts";

/** Auto-answers wait a little so the Lookout shows the pending decision before it resolves. */
const AUTO_ANSWER_DELAY_MS = 1500;
const STARTUP_TIMEOUT_MS = 15_000;
const LOG_FILE = "basecamp.log";

export const climbCommand = defineCommand({
  name: "climb",
  args: '"<pedido>"',
  summary: "começa um climb; por padrão um agente de código faz as tarefas (mohs next, mohs call)",
  flags: {
    crew: {
      type: "string",
      placeholder: "nome",
      description: `quem sobe: ${Object.values(CREW_DRIVERS)
        .map((driver) => `${driver.name} (${driver.summary})`)
        .join("; ")}. Padrão: ${DEFAULT_CREW}`,
    },
    detach: { type: "boolean", description: "roda o Basecamp em segundo plano e já mostra o primeiro passo (para agentes)" },
    ...WAIT_FLAG,
    scenario: {
      type: "string",
      placeholder: "nome",
      description: `cenário da equipe fake: ${Object.keys(SCENARIOS).join(" | ")} (padrão: ${DEFAULT_SCENARIO})`,
    },
    speed: { type: "string", placeholder: "1", description: "multiplicador de velocidade da equipe fake" },
    hardness: { type: "string", placeholder: "h", description: "força a hardness de todas as routes (talc: veja mohs fix)" },
    from: { type: "string", placeholder: "id", description: "usa o pedido de outro climb, como uma correção que pediu o fluxo completo" },
    resume: {
      type: "string",
      placeholder: "id",
      description: "retoma um climb cujo Basecamp parou, do ponto em que o log diz que ele estava",
    },
    mode: { type: "string", placeholder: "modo", description: "climb (padrão) ou croqui (use mohs croqui)" },
    "auto-sign": { type: "boolean", description: "assina a line automaticamente" },
    "auto-rescue": { type: "string", placeholder: "opção", description: `responde todo rescue com a opção (${RESCUE_OPTIONS.join(", ")})` },
    "no-lookout": { type: "boolean", description: "não sobe o Lookout junto" },
    port: { type: "string", placeholder: "n", description: "porta do Lookout" },
    exit: { type: "boolean", description: "encerra quando o climb terminar" },
    id: { type: "string", placeholder: "id", description: "id do climb (uso interno do --detach)" },
  },

  async run({ projectRoot, args, flags }) {
    const speed = Number(flags.speed ?? 1);
    const { hardness, "auto-rescue": autoRescue } = flags;
    const driver = CREW_DRIVERS[flags.crew ?? DEFAULT_CREW];
    const timeout = waitMs(flags.wait);
    if (!driver) return fail(`equipe desconhecida: ${flags.crew}. Opções: ${Object.keys(CREW_DRIVERS).join(", ")}`);
    if (!(speed > 0)) return fail("--speed precisa ser maior que zero");
    if (hardness !== undefined && !isHardness(hardness)) return fail(`hardness desconhecida: ${hardness}`);
    if (autoRescue !== undefined && !isRescueOption(autoRescue)) return fail(`opção de rescue desconhecida: ${autoRescue}`);
    if (typeof timeout === "string") return fail(timeout);
    if (flags.mode !== undefined && !isClimbMode(flags.mode)) return fail(`modo desconhecido: ${flags.mode}`);

    const config = loadConfig({ projectRoot });
    if (printConfigErrors(config.diagnostics)) return 1;

    let resume: ResumePoint | undefined;
    if (flags.resume) {
      const problem = resumeProblem(climbDir(config.mohsDir, flags.resume));
      if (problem) return fail(`não dá para retomar ${flags.resume}: ${problem}`);
      resume = resumePoint(readEvents(join(climbDir(config.mohsDir, flags.resume), EVENTS_FILE)));
    }
    const request = resume?.request || args.join(" ").trim() || (flags.from ? requestFrom(config.mohsDir, flags.from) : "");
    if (request === null) return fail(`o climb ${flags.from} não existe ou não tem pedido`);

    const climbId = flags.resume ?? flags.id ?? newClimbId(new Date());
    const dir = climbDir(config.mohsDir, climbId);
    const setup = driver.setup({ config, climbId, climbDir: dir, request, scenario: flags.scenario, speed });
    if (typeof setup === "string") return fail(setup);
    if (flags.detach) {
      const background = [
        "climb",
        setup.request,
        ...forwardedFlags(flags),
        "--id",
        climbId,
        "--no-lookout",
        "--exit",
        "--cwd",
        projectRoot,
      ];
      return detach({ projectRoot, dir, climbId, timeout, args: background });
    }

    const lookout = flags["no-lookout"]
      ? undefined
      : await startLookout({ mohsDir: config.mohsDir, port: lookoutPort(flags.port, config) });
    const basecamp = new Basecamp({
      config,
      climbId,
      crew: setup.crew,
      runner: setup.runner,
      desk: new FileDesk({ autoSign: flags["auto-sign"], autoRescue, autoDelayMs: AUTO_ANSWER_DELAY_MS / speed }),
      request: setup.request,
      scenario: setup.scenario,
      hardness,
      resume,
      stages: STAGE_SETS[flags.mode ?? "climb"],
    });

    print("", `${ink.bold("MOHs")} · climb ${ink.rope(basecamp.id)} · ${ink.dim(setup.banner)}`);
    if (lookout) print(`${ink.bold("Lookout")} · ${lookout.url}`);
    if (setup.hint) print(ink.dim(setup.hint));
    print("");
    basecamp.subscribe((event) => {
      const line = describeEvent(event, basecamp.view);
      if (line) print(line);
    });

    const view = await basecamp.run();
    if (lookout && !flags.exit) {
      print("", `O Lookout continua no ar em ${lookout.url}`, "Ctrl+C para sair.");
      await keepAlive();
    }
    await lookout?.close();
    return view.state === "done" ? 0 : 1;
  },
});

interface DetachOptions {
  projectRoot: string;
  dir: string;
  climbId: string;
  timeout: number;
  /** Arguments for the background `mohs`. */
  args: string[];
}

/**
 * Starts this same command as a background Basecamp and waits for the first thing the climb needs.
 * An agent runs one command and gets its first task; the climb survives the agent's shell.
 */
async function detach({ projectRoot, dir, climbId, timeout, args }: DetachOptions): Promise<number> {
  mkdirSync(dir, { recursive: true });
  const log = openSync(join(dir, LOG_FILE), "a");
  const child = spawn(process.execPath, [CLI_ENTRY, ...args], {
    cwd: projectRoot,
    detached: true,
    stdio: ["ignore", log, log],
    windowsHide: true,
  });
  closeSync(log);
  let exited = false;
  child.on("exit", () => (exited = true));
  child.unref();

  const deadline = Date.now() + STARTUP_TIMEOUT_MS;
  while (!basecampAlive(dir)) {
    if (exited || Date.now() > deadline) return fail(`o Basecamp não subiu; veja ${join(dir, LOG_FILE)}`);
    await sleep(100);
  }
  print(`${ink.bold("MOHs")} · climb ${ink.rope(climbId)} em segundo plano · acompanhe com ${mohsBin()} lookout`, "");
  return reportSituation(await waitForSituation(dir, timeout), { projectRoot });
}

/** The request of an earlier climb, with why it escalated when it did: the scout plans knowing it. */
function requestFrom(mohsDir: string, id: string): string | null {
  const events = readEvents(join(climbDir(mohsDir, id), EVENTS_FILE));
  const started = events.find((event) => event.type === "climb.started");
  if (started?.type !== "climb.started" || !started.data.request) return null;
  const escalated = events.findLast((event) => event.type === "climb.escalated");
  if (escalated?.type !== "climb.escalated") return started.data.request;
  return `${started.data.request}\n\n(Veio da correção ${id}, que pediu o fluxo completo: ${escalated.data.reason}.)`;
}

/** Flags that decide how the climb goes, as given; the ones about this process stay behind. */
const LOCAL_FLAGS = new Set(["detach", "no-lookout", "exit", "id", "cwd", "help", "wait", "port"]);

function forwardedFlags(flags: Record<string, string | boolean | undefined>): string[] {
  return Object.entries(flags).flatMap(([name, value]) => {
    if (LOCAL_FLAGS.has(name) || value === undefined || value === false) return [];
    return value === true ? [`--${name}`] : [`--${name}`, value];
  });
}
