import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
export const CORE_DIR = join(PACKAGE_ROOT, "core");
export const GUIDEBOOKS_DIR = join(PACKAGE_ROOT, "guidebooks");
export const ROLES_DIR = join(CORE_DIR, "roles");

export const MOHS_DIR_NAME = ".mohs";
export const CONFIG_FILE = "mohs.yaml";
export const BRAKE_FILE = "brake.yaml";

export function defaultUserDir(): string {
  return process.env.MOHS_HOME ?? join(homedir(), MOHS_DIR_NAME);
}

export function mohsDirOf(projectRoot: string): string {
  return join(projectRoot, MOHS_DIR_NAME);
}
