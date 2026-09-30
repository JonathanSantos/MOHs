import type { ResolvedConfig } from "../config/types.ts";

/** `--port` wins over `lookout.port` from the config. */
export function lookoutPort(flag: string | undefined, config: ResolvedConfig): number {
  return flag ? Number(flag) : config.settings.lookout.port;
}
