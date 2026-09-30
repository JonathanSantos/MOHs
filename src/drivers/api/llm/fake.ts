import type { AssistantBlock, CompletionRequest, CompletionResponse, ModelProvider, StopReason, Usage } from "./types.ts";

export interface ScriptedTurn {
  content: AssistantBlock[];
  stopReason?: StopReason;
  usage?: Partial<Usage>;
}

/** A turn can also be computed from the request, e.g. to answer differently per role. */
export type ScriptStep = ScriptedTurn | ((request: CompletionRequest) => ScriptedTurn);

/** Either a fixed sequence of turns or one function that answers every call. */
export type Script = ScriptStep[] | ((request: CompletionRequest, call: number) => ScriptedTurn);

/**
 * Scripted model for tests: returns the next turn from the script and records every request,
 * so tests can assert what reached the model (prompts, tools, leaked content).
 */
export class FakeProvider implements ModelProvider {
  readonly name = "fake";
  readonly requests: CompletionRequest[] = [];
  private readonly script: Script;
  private callCount = 0;

  constructor(script: Script) {
    this.script = Array.isArray(script) ? [...script] : script;
  }

  async complete(request: CompletionRequest): Promise<CompletionResponse> {
    this.requests.push(structuredClone(request));
    const turn = this.nextTurn(request, this.callCount++);
    const hasToolCall = turn.content.some((block) => block.type === "tool_call");
    return {
      message: { role: "assistant", content: turn.content, native: turn.content },
      stopReason: turn.stopReason ?? (hasToolCall ? "tool_use" : "end_turn"),
      usage: { input: 1_000, output: 200, cacheRead: 0, cacheWrite: 0, ...turn.usage },
      model: request.model,
    };
  }

  private nextTurn(request: CompletionRequest, call: number): ScriptedTurn {
    if (typeof this.script === "function") return this.script(request, call);
    const step = this.script[call];
    if (!step) throw new Error(`FakeProvider script exhausted after ${this.script.length} turns`);
    return typeof step === "function" ? step(request) : step;
  }
}

let callSeq = 0;

export function toolCall(name: string, input: unknown): AssistantBlock {
  return { type: "tool_call", id: `call_${++callSeq}`, name, input };
}

export function say(text: string): AssistantBlock {
  return { type: "text", text };
}
