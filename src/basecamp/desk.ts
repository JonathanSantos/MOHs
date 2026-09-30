import { existsSync, readFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { isRescueOption, type RescueOption } from "../domain/types.ts";
import { readText, sha256, writeText } from "../util/fs.ts";
import { sleep } from "../util/runtime.ts";
import { ClimbAborted } from "./session.ts";

export const CLIMB_FILES = {
  line: "line.md",
  signature: "signature.json",
  rescue: "rescue.json",
} as const;

export interface Signature {
  hash: string;
  by: string;
  /** The line's decisions the human settled otherwise than recommended: `D1` → `B`, or their own words. */
  choices?: Record<string, string>;
}

/** The line is signed with this target; bolts and summits use their own (`bolts-A`, `summit-A`). */
export const LINE_TARGET = "line";

export interface SignatureRequest {
  target: string;
  /** Hash of what is being signed, as it stands right now. */
  current(): string;
}

/**
 * Where human decisions reach the Basecamp: line signatures and rescue answers.
 * Decisions travel as files inside the climb folder, so the CLI, the Lookout and
 * another process all use the same channel.
 */
export interface Desk {
  /** True when signatures are given automatically (demos, tests, runs without a human). */
  readonly autoSigns?: boolean;
  waitForSignature(climbDir: string, request: SignatureRequest): Promise<Signature>;
  waitForRescue(climbDir: string, options: readonly RescueOption[]): Promise<RescueOption>;
}

export interface FileDeskOptions {
  /** Signs whatever the line currently says. For demos and tests. */
  autoSign?: boolean;
  /** Answers every rescue with this option when it is offered. */
  autoRescue?: RescueOption;
  autoDelayMs?: number;
  pollMs?: number;
  /** Stops waiting for humans; the climb ends as aborted. */
  signal?: AbortSignal;
}

const DEFAULT_POLL_MS = 250;

export class FileDesk implements Desk {
  private readonly options: FileDeskOptions;

  constructor(options: FileDeskOptions = {}) {
    this.options = options;
  }

  get autoSigns(): boolean {
    return Boolean(this.options.autoSign);
  }

  async waitForSignature(climbDir: string, request: SignatureRequest): Promise<Signature> {
    if (this.options.autoSign) {
      await sleep(this.options.autoDelayMs ?? 0);
      return { hash: request.current(), by: "auto" };
    }
    const data = await this.nextFile(signatureFile(climbDir, request.target));
    const choices = data.choices && typeof data.choices === "object" ? (data.choices as Record<string, unknown>) : {};
    const strings = Object.entries(choices).filter((entry): entry is [string, string] => typeof entry[1] === "string");
    return {
      hash: String(data.hash ?? ""),
      by: String(data.by ?? "human"),
      ...(strings.length ? { choices: Object.fromEntries(strings) } : {}),
    };
  }

  async waitForRescue(climbDir: string, options: readonly RescueOption[]): Promise<RescueOption> {
    const auto = this.options.autoRescue;
    if (auto && options.includes(auto)) {
      await sleep(this.options.autoDelayMs ?? 0);
      return auto;
    }
    for (;;) {
      const { option } = await this.nextFile(join(climbDir, CLIMB_FILES.rescue));
      if (isRescueOption(option) && options.includes(option)) return option;
    }
  }

  /** Waits for the file, consumes it (deletes) and returns its JSON. */
  private async nextFile(file: string): Promise<Record<string, unknown>> {
    for (;;) {
      if (this.options.signal?.aborted) throw new ClimbAborted("interrompido esperando uma decisão humana");
      if (existsSync(file)) {
        try {
          const data = JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
          unlinkSync(file);
          return data;
        } catch {
          // Arquivo ainda sendo escrito por outro processo: tenta de novo na próxima volta.
        }
      }
      await sleep(this.options.pollMs ?? DEFAULT_POLL_MS);
    }
  }
}

/** Where a signature for `target` is dropped for the Basecamp to pick up. */
export function signatureFile(climbDir: string, target: string): string {
  return target === LINE_TARGET ? join(climbDir, CLIMB_FILES.signature) : join(climbDir, "signatures", `${target}.json`);
}

/** Signs `target` with the hash the person saw. The Basecamp accepts it only if that is still what it holds. */
export function sign(climbDir: string, target: string, hash: string, by: string, choices?: Record<string, string>): void {
  writeText(signatureFile(climbDir, target), JSON.stringify({ hash, by, choices, at: new Date().toISOString() }));
}

/** Signs the line as it reads now, with the human's choices for its decisions. Only valid for this exact text. */
export function signLine(climbDir: string, by: string, choices?: Record<string, string>): string {
  const text = readText(join(climbDir, CLIMB_FILES.line));
  if (text === null) throw new Error("This climb has no line to sign yet");
  const hash = sha256(text);
  sign(climbDir, LINE_TARGET, hash, by, choices);
  return hash;
}

export function answerRescue(climbDir: string, option: RescueOption, by: string): void {
  writeText(join(climbDir, CLIMB_FILES.rescue), JSON.stringify({ option, by, at: new Date().toISOString() }));
}
