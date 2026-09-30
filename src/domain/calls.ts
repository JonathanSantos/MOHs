import { z } from "zod";
import { RESCUE_OPTIONS } from "./types.ts";

const climb = z.strictObject({
  call: z.literal("CLIMB"),
  from: z.literal("basecamp"),
  to: z.string(),
  route: z.string(),
  pitch: z.number().int().positive(),
  pack: z.strictObject({ tokens: z.number(), skills: z.array(z.string()), beta: z.array(z.string()) }),
});

const safe = z.strictObject({
  call: z.literal("SAFE"),
  from: z.string(),
  to: z.literal("basecamp"),
  route: z.string(),
  pitch: z.number().int().positive(),
  summary: z.string().max(280),
});

const fall = z.strictObject({
  call: z.literal("FALL"),
  from: z.string(),
  to: z.string(),
  route: z.string(),
  scenario: z.string().min(1),
  expected: z.string().min(1),
  actual: z.string().min(1),
});

const watch = z.strictObject({
  call: z.literal("WATCH"),
  from: z.string(),
  to: z.literal("basecamp"),
  route: z.string(),
  excerpt: z.string(),
  question: z.string().min(1),
});

const rock = z.strictObject({
  call: z.literal("ROCK"),
  from: z.string(),
  to: z.literal("basecamp"),
  command: z.string(),
  error: z.string(),
});

const take = z.strictObject({
  call: z.literal("TAKE"),
  from: z.literal("basecamp"),
  to: z.literal("human"),
  reason: z.string().min(1),
  options: z.array(z.enum(RESCUE_OPTIONS)).min(1),
});

/** As seis calls entre agentes: campos fixos e nenhuma prosa livre, para o Basecamp validar cada mensagem. */
export const callSchema = z.discriminatedUnion("call", [climb, safe, fall, watch, rock, take]);

export type Call = z.infer<typeof callSchema>;
export type CallName = Call["call"];
export type CallOf<N extends CallName> = Extract<Call, { call: N }>;

const SUMMARIES: { [N in CallName]: (call: CallOf<N>) => string } = {
  CLIMB: (c) =>
    `pitch ${c.pitch} · pack de ${Math.round(c.pack.tokens / 1000)}k${c.pack.skills.length ? ` · ${c.pack.skills.join(", ")}` : ""}`,
  SAFE: (c) => c.summary,
  FALL: (c) => `${c.scenario}: esperado ${c.expected}, obtido ${c.actual}`,
  WATCH: (c) => c.question,
  ROCK: (c) => `${c.command}: ${c.error}`,
  TAKE: (c) => c.reason,
};

export function summarizeCall(call: Call): string {
  return (SUMMARIES[call.call] as (c: Call) => string)(call);
}
