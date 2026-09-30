import { DEFAULT_HIDDEN, DEFAULT_READ_ONLY } from "../../brake/tool-policy.ts";
import type { ResolvedConfig } from "../../config/types.ts";
import { CrewError, type TaskContext } from "../../crew/types.ts";
import { ANSWERS, type Answer, type AnswerName, type AnswerSpec } from "../../tasks/answers.ts";
import type { TaskBoard, TaskResult, TaskSpec } from "../../tasks/task.ts";
import { AgentError, runAgent } from "./agent/loop.ts";
import { defineFinisher, type Finisher } from "./agent/tool.ts";
import type { ProviderRegistry } from "./llm/registry.ts";
import { o2Of, ProviderError } from "./llm/types.ts";
import { CLIMBER_TOOLS, READ_TOOLS } from "./tools/index.ts";

export interface ApiBoardOptions {
  config: ResolvedConfig;
  providers: ProviderRegistry;
}

/**
 * Does each task with MOHs' own agent loop over a model API (Anthropic, Kimi and other
 * OpenAI-compatible providers). The answers become finisher tools and every tool call goes through the brake.
 */
export class ApiBoard implements TaskBoard {
  private readonly options: ApiBoardOptions;

  constructor(options: ApiBoardOptions) {
    this.options = options;
  }

  async assign<N extends AnswerName>(task: TaskSpec<N>, context: TaskContext): Promise<TaskResult<N>> {
    const { settings, mohsDir } = this.options.config;
    const { provider, model } = this.options.providers.resolve(settings.models[task.crux ? "crux" : task.role]);
    const finish = task.answers.map((name) => `\`${name}\``).join(" ou ");
    try {
      const run = await runAgent({
        role: task.role,
        provider,
        model,
        system: task.brief,
        prompt: `${task.assignment}\n\nQuando terminar, chame ${finish}. Só isso encerra a tarefa.`,
        tools: task.access === "write" ? CLIMBER_TOOLS : READ_TOOLS,
        finishers: task.answers.map(finisherFor),
        rules: { root: task.cwd, denied: [mohsDir], readOnly: DEFAULT_READ_ONLY, hidden: DEFAULT_HIDDEN, allowedCommands: task.commands },
        context: { root: task.cwd, commandTimeoutMs: settings.commands.timeoutMs },
        limits: { maxTurns: settings.agents.maxTurns, maxO2: settings.agents.maxO2PerTask },
        observer: context.observer,
      });
      return { answer: run.result, o2: run.o2 };
    } catch (error) {
      throw toCrewError(error);
    }
  }
}

/** The loop validates the input against the answer's schema before `toResult` sees it. */
function finisherFor<N extends AnswerName>(name: N): Finisher<Answer<N>> {
  const spec: AnswerSpec = ANSWERS[name];
  return defineFinisher({
    name,
    description: `${spec.description} Encerra a tarefa.`,
    input: spec.schema,
    toResult: (input) => ({ call: name, input }) as Answer<N>,
  });
}

/** Provider and loop failures become the crew error the Basecamp knows how to rescue. */
function toCrewError(error: unknown): unknown {
  if (error instanceof ProviderError) return new CrewError("provider.error", error.message);
  if (error instanceof AgentError) {
    return new CrewError(error.kind === "refusal" ? "agent.refusal" : "agent.limit", error.message, o2Of(error.usage));
  }
  return error;
}
