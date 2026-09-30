import { z, type ZodType } from "zod";
import type { Access } from "../../../brake/tool-policy.ts";
import type { ToolSpec } from "../llm/types.ts";

export interface ToolContext {
  /** Workspace root; every path a tool receives is relative to it. */
  root: string;
  commandTimeoutMs: number;
}

export interface Tool<I = unknown> {
  name: string;
  description: string;
  input: ZodType<I>;
  access(input: I, context: ToolContext): Access;
  /** Returns the text the model reads. Throw ToolFailure for an error the model should see and correct. */
  run(input: I, context: ToolContext): Promise<string>;
}

/**
 * A tool whose call ends the agent's task. Its input is the agent's structured answer,
 * which is how MOHs gets typed results without forcing `tool_choice`.
 */
export interface Finisher<R, I = unknown> {
  name: string;
  description: string;
  input: ZodType<I>;
  toResult(input: I): R;
}

/** A failure the model caused and can fix (bad path, text not found…): shown to it as an error result. */
export class ToolFailure extends Error {}

export function defineTool<I>(tool: Tool<I>): Tool<I> {
  return tool;
}

export function defineFinisher<R, I>(finisher: Finisher<R, I>): Finisher<R, I> {
  return finisher;
}

export function toToolSpec(tool: { name: string; description: string; input: ZodType }): ToolSpec {
  const { $schema: _schema, ...inputSchema } = z.toJSONSchema(tool.input, { unrepresentable: "any" }) as Record<string, unknown>;
  return { name: tool.name, description: tool.description, inputSchema };
}
