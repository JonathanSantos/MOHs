import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import type { RackItem, ResolvedConfig } from "../config/types.ts";
import type {
  ClimbNotes,
  Crew,
  DisputeContext,
  DisputeVerdict,
  FallContext,
  FixResult,
  InspectContext,
  NotesContext,
  PitchContext,
  PitchOutcome,
  PitchResult,
  SealContext,
  SealedFile,
  SendFailure,
  TaskContext,
  Work,
} from "../crew/types.ts";
import type { PlannedRoute } from "../domain/plan.ts";
import { maxHardness, type FixReason, type Hardness, type Role } from "../domain/types.ts";
import { isInside } from "../util/paths.ts";
import type { ClimbView } from "../view/types.ts";
import { buildPack, splitPack, withFeedback, type Pack } from "../pack/build.ts";
import { reviewDiff } from "../pack/review-diff.ts";
import { builtInSealCommand, builtInSealCommands, countTestCases, describeBuiltInSeal } from "../runner/seal-runners.ts";
import { croquiIssues, type Croqui } from "../domain/croqui.ts";
import { listProjectFiles } from "../survey/survey.ts";
import { matchGlob, normalizePath } from "../util/glob.ts";
import { countScenarios } from "../domain/line.ts";
import type { SurveyResult } from "../survey/survey.ts";
import { CLIMBER_ANSWERS, FALL_FIX_ANSWERS, TALC_ANSWERS, type Answer, type AnswerName } from "./answers.ts";
import type { TaskBoard, TaskSpec } from "./task.ts";

export interface TaskCrewOptions {
  config: ResolvedConfig;
  board: TaskBoard;
}

type TaskRequest<N extends AnswerName> = Omit<TaskSpec<N>, "brief" | "assignment" | "commands" | "checks" | "files"> & {
  pack: Pack;
  files?: readonly string[];
  /** Commands for a writing task that is not a pitch (the belayer's); pitches get the anchor and tools.commands. */
  commands?: readonly string[];
};

type PitchAnswer = (typeof CLIMBER_ANSWERS)[number] | (typeof TALC_ANSWERS)[number];

const OUTCOMES: { [N in PitchAnswer]: (input: Answer<N>["input"]) => PitchOutcome } = {
  safe: ({ summary, notes, decisions }) => ({ outcome: "safe", summary, note: notes, decisions }),
  watch: ({ excerpt, question }) => ({ outcome: "watch", excerpt, question }),
  rock: ({ command, error }) => ({ outcome: "rock", command, error }),
  escalate: ({ reason }) => ({ outcome: "escalate", reason }),
};

const FIX_TITLES: Record<FixReason, string> = {
  fall: "Correção depois da fall",
  inspection: "Correção dos achados da inspection",
  integration: "Correção da integração",
};

/** How many times the belayer may answer with files that are not there before the climb gives up on it. */
const MAX_SEAL_ANSWERS = 3;

/**
 * The real crew. Each role becomes a task with its pack, the answers that end it and where to work;
 * the board decides who does it. The Basecamp never learns whether it was a model API, Claude Code
 * or a subagent. Every hardness is covered; diamond adds human signatures on bolts and summit.
 */
export class TaskCrew implements Crew {
  readonly supportedHardness: readonly Hardness[] = ["talc", "fluorite", "quartz", "diamond"];
  private readonly options: TaskCrewOptions;

  constructor(options: TaskCrewOptions) {
    this.options = options;
  }

  async scout(request: string, survey: SurveyResult, context: TaskContext) {
    const { answer, o2 } = await this.assign(
      {
        role: "scout",
        title: "Planejar o climb: routes, pitches e hardness",
        cwd: this.options.config.projectRoot,
        access: "read",
        pack: this.planningPack("scout", survey, scoutTask(request)),
        answers: ["plan"],
      },
      context,
    );
    return { ...answer.input, o2 };
  }

  async writeLine(request: string, routes: readonly PlannedRoute[], survey: SurveyResult, context: TaskContext) {
    const { answer, o2 } = await this.assign(
      {
        role: "setter",
        title: "Escrever a line (spec) do climb",
        cwd: this.options.config.projectRoot,
        access: "read",
        pack: this.planningPack("setter", survey, lineTask(request, routes), maxHardness(routes.map((route) => route.hardness))),
        answers: ["line"],
      },
      context,
    );
    return { text: answer.input.text, o2 };
  }

  async climbPitch(route: PlannedRoute, pitch: number, context: PitchContext): Promise<PitchResult> {
    const planned = route.pitches[pitch - 1];
    const { answer, o2 } = await this.assign(
      {
        role: "climber",
        title: `Pitch ${pitch} de ${route.pitches.length} da route ${route.id} (${route.name}): ${planned.title}`,
        route: route.id,
        pitch,
        attempt: context.attempt,
        crux: planned.crux,
        cwd: context.workspace.path,
        branch: context.workspace.branch,
        access: "write",
        pack: withFeedback(context.pack, context.feedback),
        answers: route.hardness === "talc" ? TALC_ANSWERS : CLIMBER_ANSWERS,
        files: planned.files,
      },
      context,
    );
    return { ...toOutcome(answer), o2 };
  }

  async fix(route: PlannedRoute, reason: FixReason, details: readonly string[], context: PitchContext): Promise<FixResult> {
    const feedback = [context.feedback, `Corrija:\n${details.map((detail) => `- ${detail}`).join("\n")}`].filter(Boolean).join("\n\n");
    const { answer, o2 } = await this.assign(
      {
        role: "climber",
        title: `${FIX_TITLES[reason]} · ${route.name}`,
        route: route.id,
        pitch: route.pitches.length,
        cwd: context.workspace.path,
        branch: context.workspace.branch,
        access: "write",
        pack: withFeedback(context.pack, feedback),
        answers: reason === "fall" ? FALL_FIX_ANSWERS : CLIMBER_ANSWERS,
        files: route.files,
      },
      context,
    );
    if (answer.call === "dispute") return { o2, outcome: "dispute", ...answer.input };
    return { o2, outcome: "safe", summary: answer.call === "safe" ? answer.input.summary : `${answer.call}: sem correção` };
  }

  /**
   * The belayer rereads the line against the climber's argument, in a checkout that holds the sealed files: it upholds
   * the test (explaining in behaviour) or corrects the files there. After a human sides with the climber, it corrects.
   */
  async judgeDispute(route: PlannedRoute, context: DisputeContext): Promise<DisputeVerdict> {
    for (const file of context.sealed.files) {
      mkdirSync(dirname(join(context.workspace.path, file.path)), { recursive: true });
      writeFileSync(join(context.workspace.path, file.path), file.content);
    }
    const { seal: command } = this.options.config.settings.commands;
    const runnable = (path: string) => Boolean(command ?? builtInSealCommand(path));
    let feedback: string | undefined;
    for (let attempt = 1; ; attempt++) {
      const { answer, o2 } = await this.assign(
        {
          role: "belayer",
          title: `Contestação do seal da route ${route.id} (${route.name})`,
          route: route.id,
          cwd: context.workspace.path,
          access: "write",
          pack: withFeedback(this.routePack("belayer", route, context.notes, disputeTask(context)), feedback),
          answers: context.mustAmend ? ["seal"] : ["uphold", "seal"],
          files: context.sealed.files.map((file) => file.path),
          commands: command ? [command] : builtInSealCommands(),
        },
        context,
      );
      if (answer.call === "uphold") return { o2, verdict: "uphold", reason: answer.input.reason };
      const read = readSealed(context.workspace.path, answer.input.files, runnable);
      if (typeof read !== "string") {
        const sealed = { files: read, unit: count(read, "unit"), e2e: count(read, "e2e") };
        return { o2, verdict: "amend", reason: answer.input.reason ?? "o belayer corrigiu o teste", sealed };
      }
      if (attempt >= MAX_SEAL_ANSWERS) throw new Error(`belayer answered ${attempt} times with unreadable files: ${read}`);
      feedback = read;
    }
  }

  async setBolts(route: PlannedRoute, context: NotesContext) {
    const { answer, o2 } = await this.assign(
      {
        role: "setter",
        title: `Bolts da route ${route.id} (${route.name})`,
        route: route.id,
        cwd: this.options.config.projectRoot,
        access: "read",
        pack: this.routePack("setter", route, context.notes, boltsTask(route)),
        answers: ["bolts"],
        files: route.files,
      },
      context,
    );
    return { text: answer.input.text, o2 };
  }

  /**
   * The belayer writes the tests in a throwaway checkout and answers with their paths; the crew reads the
   * files from there. A path that is missing or leaves the checkout sends the task back.
   */
  async seal(route: PlannedRoute, context: SealContext) {
    const { seal: command } = this.options.config.settings.commands;
    const budget = sealBudget(route, context.notes.line, this.options.config.settings.hardness[route.hardness].testsPerScenario);
    let warnedOversize = false;
    // Sem commands.seal, cada arquivo roda pela extensão; um arquivo que nenhum runner embutido roda volta ao belayer.
    const runnable = (path: string) => Boolean(command ?? builtInSealCommand(path));
    let feedback = context.feedback;
    let spent = 0;
    for (let attempt = 1; ; attempt++) {
      const { answer, o2 } = await this.assign(
        {
          role: "belayer",
          title: `Testes selados da route ${route.id} (${route.name})`,
          route: route.id,
          attempt: context.attempt,
          cwd: context.workspace.path,
          access: "write",
          pack: withFeedback(this.routePack("belayer", route, context.notes, sealTask(route, command, budget)), feedback),
          answers: ["seal"],
          files: [],
          commands: command ? [command] : builtInSealCommands(),
        },
        context,
      );
      spent += o2;
      const read = readSealed(context.workspace.path, answer.input.files, runnable);
      if (typeof read !== "string") {
        const cases = read
          .filter((file) => file.kind !== "support")
          .reduce((sum, file) => sum + countTestCases(file.path, file.content), 0);
        const sealed = { o2: spent, files: read, unit: count(read, "unit"), e2e: count(read, "e2e"), cases };
        if (cases <= budget.cases) return sealed;
        // Uma recusa só: enxugar é barato; recusar de novo jogaria fora o trabalho, e o excesso vira friction.
        if (warnedOversize) return { ...sealed, oversized: { cases, budget: budget.cases } };
        warnedOversize = true;
        feedback = `Você escreveu ${cases} casos de teste; o teto desta route é ${budget.cases} (${budget.text}). Um caso por comportamento: junte variações num só caso (ou test.each) e tire o que repete outro cenário. Responda de novo com os arquivos enxutos.`;
        continue;
      }
      if (attempt >= MAX_SEAL_ANSWERS) throw new Error(`belayer answered ${attempt} times with unreadable files: ${read}`);
      feedback = read;
    }
  }

  async explainFall(route: PlannedRoute, failures: readonly SendFailure[], context: FallContext) {
    const { answer, o2 } = await this.assign(
      {
        role: "belayer",
        title: `Explicar a fall da route ${route.id} (${route.name})`,
        route: route.id,
        cwd: this.options.config.projectRoot,
        access: "read",
        pack: this.routePack("belayer", route, context.notes, fallTask(failures, context.sealed.files, context.leaked)),
        answers: ["fall"],
      },
      context,
    );
    return { ...answer.input, o2 };
  }

  async inspect(route: PlannedRoute, inspector: RackItem, round: number, context: InspectContext) {
    const { answer, o2 } = await this.assign(
      {
        role: "inspector",
        title: `Inspection ${inspector.name} da route ${route.id}, rodada ${round}`,
        route: route.id,
        cwd: context.workspace.path,
        branch: context.workspace.branch,
        access: "read",
        pack: this.routePack("inspector", route, context.notes, inspectTask(inspector, context.diff)),
        answers: ["report"],
        files: route.files,
      },
      context,
    );
    return { findings: answer.input.findings, o2 };
  }

  /**
   * A reading task for the scout, with the answer checked against the project: a cited file that does not exist or a
   * sensitive glob that matches nothing sends it back, so nothing uncited reaches every later pack.
   */
  async drawCroqui(survey: SurveyResult, context: TaskContext): Promise<Work & { croqui: Croqui }> {
    const root = this.options.config.projectRoot;
    const files = listProjectFiles(root);
    const matchesAny = (glob: string) => files.some((file) => matchGlob(file, glob));
    let feedback: string | undefined;
    let spent = 0;
    for (let attempt = 1; ; attempt++) {
      const { answer, o2 } = await this.assign(
        {
          role: "scout",
          title: "Desenhar o croqui do projeto",
          cwd: root,
          access: "read",
          pack: withFeedback(this.planningPack("scout", survey, croquiTask()), feedback),
          answers: ["croqui"],
        },
        context,
      );
      spent += o2;
      const issues = croquiIssues(answer.input, (file) => files.includes(normalizePath(file)), matchesAny);
      if (!issues.length) return { o2: spent, croqui: answer.input };
      if (attempt >= MAX_SEAL_ANSWERS)
        throw new Error(`scout answered ${attempt} croquis with citations that do not hold: ${issues.join("; ")}`);
      feedback = `Estas citações não conferem com o projeto; corrija ou tire o que elas sustentam:\n${issues.map((issue) => `- ${issue}`).join("\n")}`;
    }
  }

  async descent(view: ClimbView, context: NotesContext) {
    const { answer, o2 } = await this.assign(
      {
        role: "scribe",
        title: "Descent: o que o climb ensinou",
        cwd: this.options.config.projectRoot,
        access: "read",
        pack: buildPack(this.options.config, {
          role: "scribe",
          hardness: view.hardness ?? "quartz",
          files: [],
          tags: [],
          survey: context.notes.survey,
          task: descentTask(view, this.options.config),
        }),
        answers: ["beta"],
      },
      context,
    );
    const proposals = answer.input.proposals.map((proposal, index) => ({ id: `b-${String(index + 1).padStart(2, "0")}`, ...proposal }));
    return { proposals, o2 };
  }

  // ── shared plumbing ─────────────────────────────────────────────────────

  private assign<N extends AnswerName>({ pack, files = [], commands, ...request }: TaskRequest<N>, context: TaskContext) {
    const settings = this.options.config.settings;
    const pitch = request.role === "climber";
    return this.options.board.assign(
      {
        ...request,
        ...splitPack(pack),
        files,
        commands: commands ?? (pitch ? [...settings.commands.anchor, ...settings.tools.commands] : []),
        checks: pitch ? settings.commands.anchor : [],
      },
      context,
    );
  }

  /** The pack of a role that works on one route: its rules, rack and beta, plus the survey, line and bolts. */
  private routePack(role: Role, route: PlannedRoute, notes: ClimbNotes, task: string): Pack {
    return buildPack(this.options.config, {
      role,
      hardness: route.hardness,
      files: route.files,
      tags: route.tags,
      survey: notes.survey,
      line: notes.line,
      bolts: notes.bolts,
      task,
    });
  }

  /** The scout plans before any hardness exists (quartz has no scout rules); the setter writes for the climb's hardness. */
  private planningPack(role: Role, survey: SurveyResult, task: string, hardness: Hardness = "quartz"): Pack {
    return buildPack(this.options.config, { role, hardness, files: [], tags: [], survey: survey.summary, task });
  }
}

function toOutcome(answer: Answer<PitchAnswer>): PitchOutcome {
  return (OUTCOMES[answer.call] as (input: typeof answer.input) => PitchOutcome)(answer.input);
}

function scoutTask(request: string): string {
  return [
    `Pedido: ${request}`,
    "Explore o repositório o quanto precisar para planejar com arquivos reais. Não altere nada.",
    "Prefira poucas routes e pitches pequenos. Use fluorite quando a mudança for pequena (até 3 arquivos) e não tocar autenticação, dados pessoais, pagamentos ou links públicos (URLs que dão acesso sem login).",
    "Se todas as routes forem fluorite, escreva também a line no campo line do plano: curta, com o problema, os cenários QUANDO/ENTÃO e o que fica de fora. O humano a assina e o climb não precisa da tarefa do setter.",
    "Se uma route usa o que outra cria, declare after com o id dela: ela sobe depois, partindo do resultado. No fim, o Basecamp junta todas as routes numa entrega e testa tudo junto.",
  ].join("\n\n");
}

function lineTask(request: string, routes: readonly PlannedRoute[]): string {
  const plan = routes
    .map((route) => `- ${route.id} ${route.name} (${route.hardness}): ${route.pitches.map((p) => p.title).join("; ")}`)
    .join("\n");
  return [
    `Pedido: ${request}`,
    `Plano do scout:\n${plan}`,
    "Escreva a line deste climb. Curta: uma pessoa precisa conseguir revisar e assinar em poucos minutos. Não altere nenhum arquivo.",
    ...(routes.length > 1
      ? [
          "Agrupe os cenários por route, com um título por route (por exemplo ### A. Nome da route): o belayer de cada route escreve os testes da sua seção.",
        ]
      : []),
  ].join("\n\n");
}

function boltsTask(route: PlannedRoute): string {
  return [
    `Escreva os bolts da route ${route.id} (${route.name}): toda interface nova ou alterada. Funções com assinatura e erros; rotas HTTP com método, payload e códigos de resposta; em UI, props públicas e data-testid.`,
    `Arquivos da route: ${route.files.join(", ")}.`,
    "Os bolts são o que o climber e o belayer enxergam em comum. Nada de detalhe de implementação. Não altere nenhum arquivo.",
  ].join("\n\n");
}

/** How many test cases a route's seal may have: its scenarios in the line times the hardness' allowance. */
function sealBudget(route: PlannedRoute, line: string | undefined, perScenario: number): { cases: number; text: string } {
  const scenarios = countScenarios(line, route.id);
  const cases = Math.max(1, scenarios) * perScenario;
  return { cases, text: `${scenarios || 1} cenário(s) da route na line × ${perScenario} por cenário` };
}

function sealTask(route: PlannedRoute, command: string | undefined, budget: { cases: number; text: string }): string {
  const after = route.after?.length
    ? [
        `Esta route parte do resultado de ${route.after.join(", ")}, que ainda não está no código deste diretório. Escreva contra a interface dos bolts (inclusive os herdados, na seção Bolts) e use o código real, sem imitar essas routes com dublês.`,
      ]
    : [];
  return [
    `Escreva os testes selados da route ${route.id} (${route.name}). Cada cenário QUANDO/ENTÃO desta route na line vira pelo menos um teste, usando só a interface dos bolts.`,
    `Teto: até ${budget.cases} casos de teste no total (${budget.text}). Um caso por comportamento; variações do mesmo comportamento cabem num caso só. O teto é para caber no tempo: o climber só vê as falhas, então dez casos da mesma regra não ajudam mais que um.`,
    ...after,
    `O diretório da tarefa é um checkout descartável do código atual. Crie arquivos novos de teste com a route no nome (por exemplo test/sealed/${route.id}-<assunto>.test.js) e não altere os existentes.`,
    "Cada teste precisa falhar pelo motivo certo: um teste que falha só porque a função ainda não existe (TypeError) não prova o comportamento. Cheque o resultado, a mensagem ou o código de erro esperado.",
    command
      ? `Rode cada arquivo com ${command}: todos precisam falhar agora, porque a implementação ainda não existe.`
      : `O projeto não diz como rodar um teste (commands.seal), então cada arquivo roda pela extensão, sem dependência: ${describeBuiltInSeal()}. Um arquivo passa quando o processo termina com código 0: use node:test (ou unittest), ou um script que sai com erro quando o resultado está errado. Rode cada um assim: todos precisam falhar agora, porque a implementação ainda não existe.`,
    "Faça esta tarefa num contexto isolado (um subagente novo, se você orquestra outros): quem implementa não pode ver estes testes.",
  ].join("\n\n");
}

function croquiTask(): string {
  return [
    "Desenhe o croqui deste projeto: o que alguém novo precisa saber antes de mexer nele e que o código não diz sozinho.",
    "Leia o README, a documentação, os testes e o código principal. Registre só o que é caro de tirar do código: para que o projeto serve e para quem, o vocabulário do domínio (entidades), as regras que não podem quebrar, as áreas sensíveis e as armadilhas. A estrutura de pastas o survey já dá.",
    "Cite em cada item os arquivos de onde ele vem. Seções livres são para o que este projeto pede (multi-tenant, feature flags, integrações…); deixe vazio o que não se aplica. Curto: o croqui vai no contexto de todo climb.",
    "Um humano revisa e assina antes de ele valer. Não altere nenhum arquivo.",
  ].join("\n\n");
}

function disputeTask({ dispute, fall, failures, sealed, mustAmend }: DisputeContext): string {
  return [
    `O climber contesta a FALL que recebeu: "${fall.scenario}: esperado ${fall.expected}, obtido ${fall.actual}".`,
    `Trecho da line que ele cita:\n> ${dispute.excerpt}`,
    `O argumento dele: ${dispute.argument}`,
    mustAmend
      ? "Um humano leu os dois lados e deu razão ao climber: corrija os testes selados neste diretório para seguir a line e responda seal com os arquivos (os mesmos caminhos) e o motivo."
      : "Releia a line. Se o teste exige algo que a line não diz, ou o contrário do que ela diz, corrija os testes selados neste diretório e responda seal com os arquivos (os mesmos caminhos) e o motivo. Se o teste está certo, responda uphold explicando ao climber, em comportamento observável, por que a line pede isso. Se ele contestar de novo, um humano decide.",
    `Falhas:\n${failures.map((failure) => `### ${failure.test}\n${fence(failure.output)}`).join("\n\n")}`,
    `Testes selados (já estão neste diretório):\n${sealed.files.map((file) => `### ${file.path}\n${fence(file.content)}`).join("\n\n")}`,
    "Não copie o teste nem suas asserções no uphold: o leak guard bloqueia. Um teste corrigido continua precisando falhar no código de antes da route.",
  ].join("\n\n");
}

function fallTask(failures: readonly SendFailure[], sealed: readonly SealedFile[], leaked: readonly string[] | undefined): string {
  const parts = [
    "Os testes selados falharam no send. Explique ao climber o que falhou, com a resposta fall: o cenário da line, o comportamento esperado e o obtido.",
    "O climber não vê os testes. Descreva comportamento observável; não copie código, nomes de teste nem asserções.",
    `Falhas:\n${failures.map((failure) => `### ${failure.test}\n${fence(failure.output)}`).join("\n\n")}`,
    `Testes selados:\n${sealed.map((file) => `### ${file.path}\n${fence(file.content)}`).join("\n\n")}`,
  ];
  if (leaked?.length) {
    parts.push(
      `Sua explicação anterior copiava trechos dos testes (${leaked.map((excerpt) => `"${excerpt}"`).join("; ")}). Reescreva sem eles.`,
    );
  }
  return parts.join("\n\n");
}

function inspectTask(inspector: RackItem, diff: string): string {
  return [
    `Inspection ${inspector.name}: ${inspector.description}`,
    `Rubrica:\n${inspector.body.trim()}`,
    `Diff da route, com o número de cada linha no arquivo (+ entrou, - saiu):\n${fence(reviewDiff(diff, { tests: !!inspector.tests }))}`,
    "Revise só o diff, com esta rubrica, e cite cada achado como arquivo:linha com os números à esquerda. O diretório da tarefa é o worktree da route, se precisar ler o contexto. Não altere nada.",
  ].join("\n\n");
}

function descentTask(view: ClimbView, config: ResolvedConfig): string {
  const friction = view.friction.map(
    (f) => `- ${f.kind}${f.route ? ` · route ${f.route}` : ""}${f.pitch ? ` · pitch ${f.pitch}` : ""}: ${f.detail}`,
  );
  const findings = view.routes.flatMap((route) =>
    route.findings.map((f) => `- route ${route.id} · ${f.inspector} · ${f.severity}: ${f.text}`),
  );
  const work = view.calls
    .filter((call) => call.call === "SAFE")
    .map((call) => `- ${call.route ? `route ${call.route}: ` : ""}${call.text}`);
  const names = (items: readonly RackItem[]) => items.map((item) => item.name).join(", ") || "(nenhum)";
  return [
    "O climb chegou ao summit. Leia o que aconteceu e proponha o que tornaria o próximo mais barato ou mais seguro.",
    `O que o climber fez:\n${work.join("\n") || "(nada registrado)"}`,
    `Friction:\n${friction.join("\n") || "(nenhuma)"}`,
    `Falls: ${view.falls}`,
    `Achados das inspections:\n${findings.join("\n") || "(nenhum)"}`,
    `Extensões que já existem. Skills: ${names(config.skills)}. Beta: ${names(config.beta)}. Inspectors: ${names(config.inspectors)}. Uma proposta pode criar .mohs/rack/<nome>/SKILL.md ou .mohs/beta/<nome>.md, ou mudar um item existente pelo nome.`,
    "Cada proposta cita a evidência acima (tipo, route, pitch). Prefira uma checagem determinística a mais texto. Não altere nenhum arquivo.",
  ].join("\n\n");
}

function fence(text: string, language = ""): string {
  const longest = Math.max(2, ...[...text.matchAll(/`+/g)].map((match) => match[0].length));
  const ticks = "`".repeat(longest + 1);
  return `${ticks}${language}\n${text.trimEnd()}\n${ticks}`;
}

/** Reads the files the belayer declared. Returns them, or what is wrong with the answer. */
function readSealed(
  root: string,
  declared: readonly { path: string; kind: SealedFile["kind"] }[],
  runnable: (path: string) => boolean,
): SealedFile[] | string {
  const files: SealedFile[] = [];
  for (const { path, kind } of declared) {
    const absolute = resolve(root, path);
    if (!isInside(root, absolute)) return `o caminho ${path} sai do diretório da tarefa`;
    if (kind !== "support" && !runnable(path))
      return `o projeto não tem commands.seal, e ${path} não roda sozinho. Use ${describeBuiltInSeal()}`;
    try {
      files.push({ path: path.replaceAll("\\", "/"), content: readFileSync(absolute, "utf8"), kind });
    } catch {
      return `o arquivo ${path} não existe no diretório da tarefa; crie os testes lá e responda com os caminhos relativos a ele`;
    }
  }
  return files;
}

function count(files: readonly SealedFile[], kind: SealedFile["kind"]): number {
  return files.filter((file) => file.kind === kind).length;
}
