import { realpathSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative } from "node:path";
import { matchGlob } from "./glob.ts";

/** Folders nobody walks into: dependencies, build output, VCS and MOHs internals. */
export const IGNORED_DIRS = new Set(["node_modules", ".git", ".mohs", "dist", "build", "out", "coverage", ".next", ".turbo", ".cache"]);

/** True when `path` is `root` itself or somewhere below it (works with `\` and drive letters on Windows). */
export function isInside(root: string, path: string): boolean {
  const rel = relative(root, path);
  return rel === "" || (!isAbsolute(rel) && rel !== ".." && !rel.startsWith(`..\\`) && !rel.startsWith("../"));
}

/** How a path reads on screen: relative when it is below `root`, absolute otherwise. */
export function displayPath(root: string, path: string): string {
  return isInside(root, path) ? relative(root, path) || "." : path;
}

/** Where tests usually live, in any language: files named as tests and test folders. */
const TEST_GLOBS = ["**/*.{test,spec}.*", "**/*_test.*", "**/test_*.py", "**/{test,tests,__tests__,spec,e2e}/**"];

export function isTestPath(path: string): boolean {
  return TEST_GLOBS.some((glob) => matchGlob(path, glob));
}

const DOC_GLOBS = ["**/*.{md,mdx,rst,txt,adoc}", "**/{docs,doc}/**"];

/** Documentation: it explains the code but does not change what it does, so the talc bounds leave it out. */
export function isDocPath(path: string): boolean {
  return DOC_GLOBS.some((glob) => matchGlob(path, glob));
}

/** Environment files may hold secrets; survey and tools skip them even when listing or searching. */
export function isSecretFile(path: string): boolean {
  return /^\.env(\..+)?$/.test(basename(path));
}

/**
 * The real path, following symlinks (macOS `/var` → `/private/var`, projects behind a link). A path that does not
 * exist yet (a file about to be written) keeps its name under the real path of its nearest existing parent.
 */
export function canonicalPath(path: string): string {
  try {
    return realpathSync.native(path);
  } catch {
    const parent = dirname(path);
    return parent === path ? path : join(canonicalPath(parent), basename(path));
  }
}
