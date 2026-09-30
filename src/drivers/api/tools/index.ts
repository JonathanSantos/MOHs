import type { Tool } from "../agent/tool.ts";
import { runCommand } from "./command.ts";
import { editFile, listFiles, readFile, searchFiles, writeFile } from "./files.ts";

/** Scout and setter look but never touch. */
export const READ_TOOLS: readonly Tool[] = [listFiles, readFile, searchFiles] as Tool[];

/** The climber reads, writes and runs the allowed commands. */
export const CLIMBER_TOOLS: readonly Tool[] = [listFiles, readFile, searchFiles, writeFile, editFile, runCommand] as Tool[];
