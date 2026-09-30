import { judgeToolUse, type ToolRules } from "../../../brake/tool-policy.ts";
import type { CrewObserver, ToolUseRecord } from "../../../crew/types.ts";
import type { Role } from "../../../domain/types.ts";
import {
  addUsage,
  EMPTY_USAGE,
  o2Of,
  type Message,
  type ModelProvider,
  type ToolCallBlock,
  type ToolResultBlock,
  type Usage,
} from "../llm/types.ts";
import { toToolSpec, ToolFailure, type Finisher, type Tool, type ToolContext } from "./tool.ts";

export interface AgentTask<R> {
  role: Role;
  provider: ModelProvider;
  model: string;
  /** Stable instructions (the rendered pack without the task). */
  system: string;
  /** The task itself: what changes from one call to the next. */
  prompt: string;
  tools: readonly Tool[];
  finishers: readonly Finisher<R>[];
  rules: ToolRules;
  context: ToolContext;
  limits: { maxTurns: number; maxO2: number };
  observer?: CrewObserver;
}

export interface AgentOutcome<R> {
  result: R;
  usage: Usage;
  o2: number;
  turns: number;
}

export type AgentErrorKind = "turns" | "o2" | "refusal" | "truncated";

export class AgentError extends Error {
  readonly kind: AgentErrorKind;
  readonly usage: Usage;

  constructor(kind: AgentErrorKind, message: string, usage: Usage) {
    super(message);
    this.kind = kind;
    this.usage = usage;
  }
}

const MAX_TOKENS = 16_000;
const MAX_NUDGES = 2;

/**
 * The agent loop: ask the model, run the tools it calls (after the brake allows them), and stop
 * when it calls one of the finishers. History is append-only, which some models require.
 */
export async function runAgent<R>(task: AgentTask<R>): Promise<AgentOutcome<R>> {
  const specs = [...task.tools, ...task.finishers].map(toToolSpec);
  const messages: Message[] = [{ role: "user", content: [{ type: "text", text: task.prompt }] }];
  let usage = EMPTY_USAGE;
  let nudges = 0;

  for (let turn = 1; turn <= task.limits.maxTurns; turn++) {
    const response = await task.provider.complete({
      model: task.model,
      system: task.system,
      messages,
      tools: specs,
      maxTokens: MAX_TOKENS,
    });
    usage = addUsage(usage, response.usage);
    messages.push(response.message);

    if (response.stopReason === "refusal") throw new AgentError("refusal", `${task.role}: o modelo recusou a tarefa`, usage);
    if (response.stopReason === "max_tokens") throw new AgentError("truncated", `${task.role}: resposta cortada por max_tokens`, usage);
    if (o2Of(usage) > task.limits.maxO2)
      throw new AgentError("o2", `${task.role}: passou do O₂ da tarefa (${o2Of(usage)} > ${task.limits.maxO2})`, usage);
    if (response.stopReason === "pause") continue;

    const calls = response.message.content.filter((block): block is ToolCallBlock => block.type === "tool_call");
    if (!calls.length) {
      if (++nudges > MAX_NUDGES) throw new AgentError("turns", `${task.role}: terminou sem chamar ${finisherNames(task)}`, usage);
      messages.push({
        role: "user",
        content: [{ type: "text", text: `Para concluir, chame uma destas ferramentas: ${finisherNames(task)}.` }],
      });
      continue;
    }

    const results: ToolResultBlock[] = [];
    for (const call of calls) {
      const finisher = task.finishers.find((f) => f.name === call.name);
      if (finisher) {
        const parsed = finisher.input.safeParse(call.input);
        if (parsed.success) return { result: finisher.toResult(parsed.data), usage, o2: o2Of(usage), turns: turn };
        results.push(errorResult(call, `entrada inválida para ${call.name}: ${parsed.error.message}`));
        continue;
      }
      results.push(await runTool(task, call, turn));
    }
    // Todos os resultados voltam numa única mensagem: separar ensina o modelo a parar de chamar em paralelo.
    messages.push({ role: "user", content: results });
  }
  throw new AgentError("turns", `${task.role}: atingiu o limite de ${task.limits.maxTurns} turnos`, usage);
}

async function runTool<R>(task: AgentTask<R>, call: ToolCallBlock, turn: number): Promise<ToolResultBlock> {
  const started = Date.now();
  const record = (outcome: ToolUseRecord["outcome"], detail?: string) =>
    task.observer?.onToolUse?.({ role: task.role, turn, tool: call.name, outcome, detail, ms: Date.now() - started });

  const tool = task.tools.find((t) => t.name === call.name);
  if (!tool) {
    record("error", "ferramenta desconhecida");
    return errorResult(call, `ferramenta desconhecida: ${call.name}`);
  }
  const parsed = tool.input.safeParse(call.input);
  if (!parsed.success) {
    record("error", "entrada inválida");
    return errorResult(call, `entrada inválida: ${parsed.error.message}`);
  }

  try {
    const verdict = judgeToolUse(tool.access(parsed.data, task.context), task.rules);
    if (!verdict.allowed) {
      record("denied", verdict.reason);
      task.observer?.onDenied?.(call.name, verdict.reason);
      return errorResult(call, `negado pelo brake: ${verdict.reason}`);
    }
    const output = await tool.run(parsed.data, task.context);
    record("ok");
    return { type: "tool_result", callId: call.id, content: output };
  } catch (error) {
    // Falhas previstas (ToolFailure) e erros de sistema de arquivos viram mensagem para o modelo; o resto é bug e sobe.
    if (!(error instanceof ToolFailure) && !isSystemError(error)) throw error;
    record("error", (error as Error).message);
    return errorResult(call, (error as Error).message);
  }
}

function isSystemError(error: unknown): boolean {
  return error instanceof Error && typeof (error as NodeJS.ErrnoException).code === "string";
}

function errorResult(call: ToolCallBlock, content: string): ToolResultBlock {
  return { type: "tool_result", callId: call.id, content, isError: true };
}

function finisherNames<R>(task: AgentTask<R>): string {
  return task.finishers.map((f) => f.name).join(", ");
}
