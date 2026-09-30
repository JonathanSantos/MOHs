import Anthropic from "@anthropic-ai/sdk";
import type { Effort } from "../../../config/types.ts";
import {
  ProviderError,
  type AssistantBlock,
  type CompletionRequest,
  type CompletionResponse,
  type Message,
  type ModelProvider,
  type StopReason,
} from "./types.ts";

type BetaMessageParam = Anthropic.Beta.Messages.BetaMessageParam;
type BetaContentBlock = Anthropic.Beta.Messages.BetaContentBlock;

export interface AnthropicProviderOptions {
  /** Omit to let the SDK resolve credentials (ANTHROPIC_API_KEY, auth token or `ant auth login` profile). */
  apiKey?: string;
  baseURL?: string;
  effort: Effort;
  /** Server-side refusal fallback: a declined request is re-run on a fallback model inside the same call. */
  fallbacks: boolean;
  maxRetries?: number;
}

const FALLBACK_BETA = "server-side-fallback-2026-07-01";

const STOP_REASONS: Record<string, StopReason> = {
  end_turn: "end_turn",
  tool_use: "tool_use",
  max_tokens: "max_tokens",
  refusal: "refusal",
  pause_turn: "pause",
};

/** Claude through the official SDK, with prompt caching and the refusal fallback on by default. */
export class AnthropicProvider implements ModelProvider {
  readonly name = "anthropic";
  private readonly client: Anthropic;
  private readonly options: AnthropicProviderOptions;

  constructor(options: AnthropicProviderOptions) {
    this.options = options;
    this.client = new Anthropic({ apiKey: options.apiKey, baseURL: options.baseURL, maxRetries: options.maxRetries ?? 4 });
  }

  async complete(request: CompletionRequest): Promise<CompletionResponse> {
    try {
      const response = await this.client.beta.messages.create({
        model: request.model,
        max_tokens: request.maxTokens,
        // Duas marcas de cache: o system (estável entre chamadas) e o fim do histórico (automática),
        // para que cada turno do loop releia o prefixo do cache em vez de pagar de novo.
        system: [{ type: "text", text: request.system, cache_control: { type: "ephemeral" } }],
        cache_control: { type: "ephemeral" },
        tools: request.tools.map((tool) => ({
          name: tool.name,
          description: tool.description,
          input_schema: tool.inputSchema as Anthropic.Beta.Messages.BetaTool.InputSchema,
        })),
        messages: request.messages.map(toAnthropicMessage),
        output_config: { effort: this.options.effort },
        ...(this.options.fallbacks ? { betas: [FALLBACK_BETA], fallbacks: "default" as const } : {}),
      });
      return {
        message: { role: "assistant", content: response.content.flatMap(toAssistantBlock), native: response.content },
        stopReason: STOP_REASONS[response.stop_reason ?? ""] ?? "other",
        usage: {
          input: response.usage.input_tokens,
          output: response.usage.output_tokens,
          cacheRead: response.usage.cache_read_input_tokens ?? 0,
          cacheWrite: response.usage.cache_creation_input_tokens ?? 0,
        },
        model: response.model,
      };
    } catch (error) {
      throw toProviderError(error);
    }
  }
}

function toAnthropicMessage(message: Message): BetaMessageParam {
  if (message.role === "assistant") return { role: "assistant", content: message.native as BetaContentBlock[] };
  return {
    role: "user",
    content: message.content.map((block) =>
      block.type === "text"
        ? { type: "text", text: block.text }
        : { type: "tool_result", tool_use_id: block.callId, content: block.content, is_error: block.isError ?? false },
    ),
  };
}

function toAssistantBlock(block: BetaContentBlock): AssistantBlock[] {
  if (block.type === "text") return [{ type: "text", text: block.text }];
  if (block.type === "tool_use") return [{ type: "tool_call", id: block.id, name: block.name, input: block.input }];
  return [];
}

/** Keeps the typed SDK errors apart: only rate limits, overload and connection problems are worth retrying later. */
function toProviderError(error: unknown): ProviderError {
  if (error instanceof Anthropic.AuthenticationError) {
    return new ProviderError("Anthropic recusou as credenciais. Defina ANTHROPIC_API_KEY ou rode `ant auth login`.", false, {
      cause: error,
    });
  }
  if (error instanceof Anthropic.RateLimitError)
    return new ProviderError("Anthropic: limite de requisições atingido.", true, { cause: error });
  if (error instanceof Anthropic.APIConnectionError) return new ProviderError("Anthropic: falha de conexão.", true, { cause: error });
  if (error instanceof Anthropic.APIError) {
    return new ProviderError(`Anthropic ${error.status ?? ""}: ${error.message}`, (error.status ?? 0) >= 500, { cause: error });
  }
  return new ProviderError((error as Error).message ?? String(error), false, { cause: error });
}
