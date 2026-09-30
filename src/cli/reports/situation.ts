import { basename, join, resolve } from "node:path";
import { optionLetter, type LineDecision } from "../../domain/decisions.ts";
import { LINE_TARGET } from "../../basecamp/desk.ts";
import { describeEvidence } from "../../domain/evidence.ts";
import { answerLimits, ANSWERS, type AnswerName } from "../../tasks/answers.ts";
import type { TaskRecord } from "../../tasks/file-board.ts";
import { isSealedRole } from "../../tasks/selection.ts";
import type { Situation, TaskBrief } from "../../tasks/situation.ts";
import { readText, sha256, writeText } from "../../util/fs.ts";
import { mohsBin, quote } from "../invocation.ts";
import { fail, ink, print } from "../terminal.ts";

export interface ReportOptions {
  projectRoot: string;
  json?: boolean;
  /** The agent asking (`--as`): commands carry its name, and sections it already read are not repeated. */
  as?: string;
  /** Show every section, even those this agent already read. */
  full?: boolean;
  climbDir?: string;
}

type Renderer<K extends Situation["kind"]> = (situation: Extract<Situation, { kind: K }>, options: ReportOptions) => string[];

/** What an agent reads after `mohs next` or `mohs call`: always says what to do next, and who does it. */
const RENDERERS: { [K in Situation["kind"]]: Renderer<K> } = {
  task: ({ task, others }, options) => renderTask(task, others, options),

  handoff: ({ tasks }, { projectRoot }) => {
    const [first] = tasks;
    const route = first.route ? ` --route ${first.route}` : "";
    return [
      `Próxima tarefa: ${tasks.map(describeBrief).join("; ")}. É de outro papel ou de outra route, então não aparece aqui.`,
      `Quem cuida dela pega com: ${command(projectRoot, `next --role ${first.role}${route}`)}`,
      `Se você faz todos os papéis sozinho, siga com: ${command(projectRoot, "next")}`,
    ];
  },

  board: ({ tasks }, { projectRoot }) => [
    `Há ${tasks.length} tarefa(s) aberta(s). Cada uma vai para um agente do papel dela; se você orquestra, crie um subagente por papel e route e passe a ele o comando da linha:`,
    ...tasks.map(
      (task) =>
        `  ${task.id} · ${task.role}${task.route ? ` · route ${task.route}` : ""} · ${task.title}${task.claimedBy ? ` (com ${task.claimedBy})` : ` → ${command(projectRoot, takeCommand(task))}`}`,
    ),
    ...(tasks.some((task) => isSealedRole(task.role))
      ? ["Tarefa de belayer só aparece para quem pede o papel: quem escreve os testes selados não implementa depois."]
      : []),
    ...stillWorking(tasks),
    `Se você faz os outros papéis sozinho, abra uma tarefa com: ${command(projectRoot, "next --task <id>")}`,
  ],

  apart: ({ tasks, took }, { projectRoot, as }) => [
    `${as ?? "Você"} já fez tarefa de ${took} neste climb, e ${tasks.map(describeBrief).join("; ")} precisa de outro agente.`,
    `Quem escreve os testes selados não implementa, e quem implementa não vê os testes. Pare aqui e avise quem orquestra; o outro agente pega com: ${command(projectRoot, takeCommand(tasks[0]))}`,
  ],

  held: ({ tasks }, { projectRoot, as }) => [
    `Nada para ${as ?? "você"} agora: ${tasks.map((task) => `${task.id} está com ${task.claimedBy} desde ${clock(task.claimedAt)}`).join("; ")}.`,
    `Espere e rode de novo: ${command(projectRoot, `next${as ? ` --as ${as}` : ""}`)}`,
    ...stillWorking(tasks),
  ],

  signature: ({ target, what, review, decisions }, { projectRoot }) => [
    `${ink.bold(`${what} espera a assinatura humana. Agora é a vez do humano.`)}`,
    ...(target === LINE_TARGET ? [`Para você conferir o que foi gravado: ${command(projectRoot, "line")}`] : []),
    ...describeDecisions(decisions ?? [], projectRoot),
    `Peça ao humano para revisar ${review} (ou no Lookout: ${command(projectRoot, "lookout")}) e assinar com: ${command(projectRoot, target === LINE_TARGET ? "sign" : `sign ${target}`)}`,
    "Não assine no lugar do humano.",
    `Depois da assinatura, rode: ${command(projectRoot, "next")}`,
  ],

  rescue: ({ reason, options }, { projectRoot }) => [
    `${ink.bold("O Basecamp precisa de uma decisão humana.")}`,
    reason,
    `Opções: ${options.map((option) => command(projectRoot, `rescue ${option}`)).join("  |  ")}`,
    `Repasse ao humano. Depois da resposta, rode: ${command(projectRoot, "next")}`,
  ],

  working: ({ detail }, { projectRoot }) => [
    `O Basecamp está trabalhando: ${detail}.`,
    `Rode de novo em instantes: ${command(projectRoot, "next")}`,
  ],

  done: ({ view }) => {
    const lines = [ink.ok(ink.bold("Climb concluído."))];
    if (view.croqui) lines.push(`Croqui assinado e salvo em ${view.croqui}: os próximos climbs o levam no pack (mohs croqui --show mostra).`);
    for (const route of view.routes) {
      const commits = route.commits === undefined ? "" : ` · ${route.commits} commit${route.commits === 1 ? "" : "s"}`;
      const grade = route.evidence ? ` · evidência ${route.evidence.grade}` : "";
      lines.push(`  ${route.id} · ${route.name} · ${route.state}${route.branch ? ` · ${route.branch}` : ""}${commits}${grade}`);
    }
    for (const route of view.routes.filter((r) => r.decisions?.length)) {
      lines.push("", `Decisões que o climber tomou sozinho na route ${route.id} (assinadas no summit):`);
      for (const decision of route.decisions!) lines.push(`  • ${decision}`);
    }
    const weak = view.routes.filter((route) => route.evidence && ["fraca", "nenhuma"].includes(route.evidence.grade));
    for (const route of weak) {
      lines.push(ink.warn(`  Atenção: a route ${route.id} tem ${describeEvidence(route.evidence!)}. Nenhum teste provou o comportamento: revise o diff antes do merge.`));
    }
    if (view.delivery?.branch) {
      lines.push(`  entrega · ${view.delivery.merged.join(" + ")} juntas · ${view.delivery.branch}${view.delivery.commits ? ` · ${view.delivery.commits} commits` : ""}`);
    }
    const notes = view.friction.filter((friction) => friction.kind === "crew.note");
    if (notes.length) {
      lines.push("", "Notas do climber para o humano (ficaram fora do escopo):");
      for (const note of notes) lines.push(`  • ${note.route ? `route ${note.route}: ` : ""}${note.detail}`);
    }
    const pending = view.proposals.filter((proposal) => proposal.status === "pending").length;
    if (pending) lines.push("", `O scribe deixou ${pending} proposta(s) para o humano escolher: mohs beta`);
    if (view.delivery?.branch) {
      lines.push("", `Para trazer tudo, já testado junto: git merge ${view.delivery.branch}`);
      return lines;
    }
    const branches = view.routes.filter((route) => route.state === "summited" && route.branch && route.commits);
    if (branches.length) lines.push("", "Para trazer as mudanças: " + branches.map((route) => `git merge ${route.branch}`).join(" && "));
    return lines;
  },

  aborted: ({ reason }) => [ink.crit(ink.bold("Climb interrompido.")), reason],

  escalated: ({ reason, climb }, { projectRoot }) => [
    ink.warn(ink.bold("A correção pediu o fluxo completo.")),
    `Motivo: ${reason}.`,
    `Para seguir com plano, line e assinatura antes do trabalho, com o mesmo pedido: ${command(projectRoot, `climb --from ${climb} --detach`)}`,
    "O que o climber fez ficou na branch da correção, só para consulta.",
  ],

  stopped: () => [],
};

export function reportSituation(situation: Situation, options: ReportOptions): number {
  if (options.json) {
    print(JSON.stringify(situation, null, 2));
    return situation.kind === "stopped" ? 1 : 0;
  }
  if (situation.kind === "stopped") {
    const resume = options.climbDir ? ` Retome de onde ele parou com: ${command(options.projectRoot, `climb --resume ${basename(options.climbDir)} --detach`)}` : "";
    return fail(`o processo do Basecamp deste climb não está rodando.${resume}`);
  }
  print(...(RENDERERS[situation.kind] as (s: Situation, o: ReportOptions) => string[])(situation, options));
  return 0;
}

function renderTask(task: TaskRecord, others: readonly TaskRecord[], options: ReportOptions): string[] {
  const { projectRoot, as } = options;
  const where = [task.route && `route ${task.route}`, task.pitch && `pitch ${task.pitch}`, task.attempt && task.attempt > 1 && `tentativa ${task.attempt}`];
  const lines = [
    ink.bold(`MOHs · tarefa ${task.id} · ${task.role}${where.filter(Boolean).map((part) => ` · ${part}`).join("")}${as ? ` · com ${as}` : ""}`),
    task.title,
    "",
    task.access === "write"
      ? `Onde trabalhar: ${task.cwd}${task.branch ? ` (branch ${task.branch}; o Basecamp faz os commits)` : ""}`
      : `Onde ler: ${task.cwd}. Tarefa só de leitura: não altere nenhum arquivo.`,
  ];
  if (resolve(task.cwd) !== resolve(projectRoot)) {
    lines.push(`Os comandos mohs abaixo levam --cwd com a raiz do projeto, onde o MOHs guarda o climb. Rode-os como estão, de qualquer pasta.`);
  }
  if (task.files.length) lines.push(`Arquivos previstos: ${task.files.join(", ")}`);
  if (task.checks.length) lines.push(`Depois da resposta, o Basecamp roda: ${task.checks.join(" · ")}`);
  // Os limites vêm antes do trabalho: quem só os descobre na recusa reescreve a resposta inteira.
  const [main] = task.answers;
  const limits = answerLimits(main);
  if (limits.length) lines.push(`Limites da resposta ${main} (escreva já dentro deles): ${limits.join("; ")}.`);
  if (task.rejection) lines.push("", ink.crit(`Sua última resposta foi recusada: ${task.rejection}`));
  lines.push("", "────────", "", briefFor(task, options), "", task.assignment, "", "────────", "");
  lines.push(ink.bold("Como responder."), "A tarefa só termina com um destes comandos, e a saída dele já traz o próximo passo.", "");
  const flags = ` --task ${task.id}${as ? ` --as ${quote(as)}` : ""}`;
  for (const name of task.answers) lines.push(...answerUsage(name, task, projectRoot, flags, name !== main), "");
  if (others.length) {
    lines.push(`Também abertas para você: ${others.map((other) => `${other.id} (${other.title})`).join("; ")}.`);
    lines.push(`Para ver uma delas: ${command(projectRoot, `next --task <id>${as ? ` --as ${quote(as)}` : ""}`, task.cwd)}.`);
  }
  return lines;
}

/**
 * The stable part of the pack, minus what this agent already read in this climb: each repeated section becomes one
 * line with its hash. Only for agents that give a name (`--as`); `--full` shows everything again.
 */
function briefFor(task: TaskRecord, { as, full, climbDir }: ReportOptions): string {
  if (!as || full || !climbDir) return task.brief;
  const file = join(climbDir, "tasks", "seen", `${as.replace(/[^\w-]/g, "_")}.json`);
  const seen = new Set<string>(parseList(readText(file)));
  const sections = task.brief.split(/\n\n(?=## )/).map((section) => {
    const hash = sha256(section).slice(0, 10);
    if (seen.has(hash)) {
      const title = /^## (.+)$/m.exec(section)?.[1] ?? "seção";
      return `## ${title}\n\n(igual à que você já recebeu · ${hash}; para ver de novo: mohs next --full --task ${task.id})`;
    }
    seen.add(hash);
    return section;
  });
  writeText(file, JSON.stringify([...seen]));
  return sections.join("\n\n");
}

function parseList(text: string | null): string[] {
  try {
    const value = JSON.parse(text ?? "[]") as unknown;
    return Array.isArray(value) ? value.map(String) : [];
  } catch {
    return [];
  }
}

/** How an agent of the task's role takes it, named after the role and the route (`climber-A`). */
function takeCommand(task: TaskBrief): string {
  const route = task.route ? ` --route ${task.route}` : "";
  return `next --role ${task.role}${route} --as ${task.role}${task.route ? `-${task.route}` : ""}`;
}

function describeBrief(task: TaskBrief): string {
  return `${task.id}, de ${task.role}${task.route ? ` na route ${task.route}` : ""} (${task.title})`;
}

function clock(iso: string | undefined): string {
  return iso ? iso.slice(11, 16) : "agora";
}

function answerUsage(name: AnswerName, task: TaskRecord, projectRoot: string, flags: string, withLimits: boolean): string[] {
  const spec = ANSWERS[name];
  const call = command(projectRoot, `call ${name}${flags}`, task.cwd);
  const head = `• ${ink.rope(name)}: ${spec.description}`;
  const text = spec.textField ? String((spec.example as Record<string, unknown>)[spec.textField]) : undefined;

  const limits = withLimits ? answerLimits(name) : [];
  const hint = [...(spec.hint ? [`  ${spec.hint}`] : []), ...(limits.length ? [`  Limites: ${limits.join("; ")}.`] : [])];
  if (text !== undefined && !text.includes("\n")) return [head, `  ${call} "<${spec.placeholder ?? spec.textField}>"`, ...hint];
  const body = text ?? compactJson(spec.example);
  return [
    head,
    "  Exemplo ilustrativo (troque pelo seu conteúdo):",
    `  ${call} <<'EOF'`,
    ...body.split("\n").map((line) => `  ${line}`),
    "  EOF",
    `  (ou salve ${text === undefined ? "o JSON" : "o texto"} em um arquivo e use ${call} --file <arquivo>)`,
    ...hint,
  ];
}

/** Indented JSON with lists of plain values kept on one line: readable and cheaper to read. */
function compactJson(value: unknown): string {
  return JSON.stringify(value, null, 2).replace(/\[\s+([^[\]{}]*?)\s+\]/g, (_match, items: string) => `[${items.replace(/\s*\n\s*/g, " ")}]`);
}

/**
 * A runnable command. Away from the project folder (a worktree has no `.mohs`) it carries --cwd:
 * when the agent called from elsewhere, or when the task sends it to work elsewhere.
 */
function command(projectRoot: string, rest: string, workDir: string = projectRoot): string {
  const here = [workDir, process.cwd()].every((dir) => resolve(dir) === resolve(projectRoot));
  return `${mohsBin()} ${rest}${here ? "" : ` --cwd ${quote(projectRoot)}`}`;
}

/** The line's decisions as the human chooses them: the recommended first, a warning when it goes against the request. */
function describeDecisions(decisions: readonly LineDecision[], projectRoot: string): string[] {
  if (!decisions.length) return [];
  return [
    "",
    "Decisões que o pedido deixou em aberto (a recomendada vem primeiro; o humano pode escolher outra ou responder com as palavras dele):",
    ...decisions.flatMap((decision) => [
      `  ${decision.id} · ${decision.question}`,
      `     ${decision.options.map((option, index) => `${optionLetter(index)}${index === 0 ? " (recomendada)" : ""}: ${option.choice}`).join("  ·  ")}`,
      ...(decision.against ? [`     ${ink.warn(`⚠ a recomendada contraria o pedido: "${decision.against}"`)}`] : []),
    ]),
    `Com as recomendadas: ${command(projectRoot, "sign")}  ·  com outras escolhas: ${command(projectRoot, 'sign D1=B "D2=…"')}`,
    "",
  ];
}

/** Tasks other agents hold: whoever orchestrates waits for them, never ends its turn with them still running. */
function stillWorking(tasks: readonly TaskBrief[]): string[] {
  const agents = [...new Set(tasks.flatMap((task) => (task.claimedBy ? [task.claimedBy] : [])))];
  if (!agents.length) return [];
  return [
    `Em andamento com ${agents.join(", ")}: se você orquestra, espere cada um terminar antes de encerrar o seu turno ou relatar o climb. Um relato com subagentes ainda rodando deixa o climb sem ninguém olhando.`,
  ];
}
