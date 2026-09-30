/**
 * Provider-neutral view of a model conversation. Providers translate to and from their own wire
 * format; the agent loop only ever sees these types.
 */

export interface TextBlock {
  type: "text";
  text: string;
}

export interface ToolCallBlock {
  type: "tool_call";
  id: string;
  name: string;
  input: unknown;
}

export interface ToolResultBlock {
  type: "tool_result";
  callId: string;
  content: string;
  isError?: boolean;
}

export type AssistantBlock = TextBlock | ToolCallBlock;

export interface UserMessage {
  role: "user";
  content: (TextBlock | ToolResultBlock)[];
}

export interface AssistantMessage {
  role: "assistant";
  content: AssistantBlock[];
  /**
   * The provider's own message, replayed byte for byte on the next request. Some models (Claude
   * Sonnet 5.5, for instance) reject a history where their earlier turns were edited or stripped.
   */
  native: unknown;
}

export type Message = UserMessage | AssistantMessage;

export interface ToolSpec {
  name: string;
  description: string;
  /** JSON Schema of the input. */
  inputSchema: Record<string, unknown>;
}

export interface CompletionRequest {
  model: string;
  /** Stable instructions, sent first so consecutive calls share a cacheable prefix. */
  system: string;
  messages: Message[];
  tools: ToolSpec[];
  maxTokens: number;
}

export type StopReason = "end_turn" | "tool_use" | "max_tokens" | "refusal" | "pause" | "other";

export interface Usage {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

export interface CompletionResponse {
  message: AssistantMessage;
  stopReason: StopReason;
  usage: Usage;
  /** Model that actually answered (differs from the request when a fallback ran). */
  model: string;
}

export interface ModelProvider {
  readonly name: string;
  complete(request: CompletionRequest): Promise<CompletionResponse>;
}

export const EMPTY_USAGE: Usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };

export function addUsage(a: Usage, b: Usage): Usage {
  return {
    input: a.input + b.input,
    output: a.output + b.output,
    cacheRead: a.cacheRead + b.cacheRead,
    cacheWrite: a.cacheWrite + b.cacheWrite,
  };
}

/**
 * O₂ is the token budget unit. Cache reads cost about a tenth of a fresh input token, so they count
 * at 10%; everything else counts in full. This keeps caching visibly cheaper in the Lookout.
 */
export function o2Of(usage: Usage): number {
  return usage.input + usage.cacheWrite + usage.output + Math.round(usage.cacheRead * 0.1);
}

export class ProviderError extends Error {
  readonly retryable: boolean;

  constructor(message: string, retryable: boolean, options?: { cause?: unknown }) {
    super(message, options);
    this.retryable = retryable;
  }
}
