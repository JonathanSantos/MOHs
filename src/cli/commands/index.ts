import type { Command } from "../command.ts";
import { agentCommand } from "./agent.ts";
import { betaCommand } from "./beta.ts";
import { callCommand } from "./call.ts";
import { climbCommand } from "./climb.ts";
import { croquiCommand } from "./croqui.ts";
import { fixCommand } from "./fix.ts";
import { rescueCommand, signCommand } from "./decisions.ts";
import { doctorCommand } from "./doctor.ts";
import { hookCommand } from "./hook.ts";
import { initCommand } from "./init.ts";
import { lineCommand } from "./line.ts";
import { lookoutCommand } from "./lookout.ts";
import { nextCommand } from "./next.ts";
import { rackCommand } from "./rack.ts";
import { reportCommand } from "./report.ts";

/** Order here is the order in `mohs help`. */
export const COMMANDS: readonly Command[] = [
  initCommand,
  doctorCommand,
  rackCommand,
  climbCommand,
  fixCommand,
  croquiCommand,
  nextCommand,
  callCommand,
  agentCommand,
  lookoutCommand,
  lineCommand,
  signCommand,
  rescueCommand,
  betaCommand,
  reportCommand,
  hookCommand,
];
