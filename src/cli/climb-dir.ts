import { climbDir, listClimbIds } from "../basecamp/event-log.ts";
import { mohsDirOf } from "../config/paths.ts";
import { isDir } from "../util/fs.ts";

/** Folder of the given climb, or of the most recent one (ids sort chronologically). */
export function resolveClimbDir(projectRoot: string, climbId?: string): string | null {
  const mohsDir = mohsDirOf(projectRoot);
  const id = climbId ?? listClimbIds(mohsDir).sort().at(-1);
  if (!id) return null;
  const dir = climbDir(mohsDir, id);
  return isDir(dir) ? dir : null;
}

export const CLIMB_FLAG = { climb: { type: "string", placeholder: "id", description: "climb alvo (padrão: o mais recente)" } } as const;

export const NO_CLIMB = "nenhum climb encontrado neste projeto";

/** `--wait` in seconds, for commands that wait on the Basecamp. */
export const WAIT_FLAG = {
  wait: { type: "string", placeholder: "s", description: "quanto esperar o Basecamp, em segundos (padrão: 90)" },
} as const;

const DEFAULT_WAIT_S = 90;

export function waitMs(flag: string | undefined): number | string {
  const seconds = flag === undefined ? DEFAULT_WAIT_S : Number(flag);
  return Number.isFinite(seconds) && seconds >= 0 ? seconds * 1000 : "--wait precisa ser um número de segundos";
}
