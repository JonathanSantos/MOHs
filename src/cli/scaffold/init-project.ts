import { join } from "node:path";
import { CONFIG_FILE, MOHS_DIR_NAME, mohsDirOf } from "../../config/paths.ts";
import { isFile, writeTree } from "../../util/fs.ts";
import { detectProject, type ProjectProfile } from "./detect.ts";
import { scaffoldFiles } from "./templates.ts";
import type { TestOptionId } from "./test-plan.ts";

export type InitResult = { created: string[]; profile: ProjectProfile } | { alreadyInitialized: true };

export function initProject(projectRoot: string, { force = false, tests }: { force?: boolean; tests?: TestOptionId } = {}): InitResult {
  const mohsDir = mohsDirOf(projectRoot);
  if (isFile(join(mohsDir, CONFIG_FILE)) && !force) return { alreadyInitialized: true };

  const profile = detectProject(projectRoot, tests);
  const files = scaffoldFiles(profile);
  writeTree(mohsDir, files);
  return { created: Object.keys(files).map((file) => `${MOHS_DIR_NAME}/${file}`), profile };
}
