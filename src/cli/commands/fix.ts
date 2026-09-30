import { climbCommand } from "./climb.ts";
import { defineCommand } from "../command.ts";

/**
 * A small fix on the talc track: no scout, no line, one climber task. The harness still isolates the work, runs the
 * checks and commits; the climber lists the choices it made and a human signs them with the diff at the end.
 */
export const fixCommand = defineCommand({
  name: "fix",
  args: '"<pedido>"',
  summary: "correção pequena (talc): o climber faz direto, sem plano nem line, e o humano assina no fim",
  flags: climbCommand.flags,
  run: (context) => climbCommand.run({ ...context, flags: { ...context.flags, hardness: "talc" } }),
});
