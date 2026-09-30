import { relative, resolve } from "node:path";
import { normalizePath } from "../../../util/glob.ts";
import { isInside } from "../../../util/paths.ts";
import { ToolFailure } from "../agent/tool.ts";

export interface WorkspacePath {
  absolute: string;
  /** Always with `/`, relative to the workspace root. */
  relative: string;
}

/** Resolves a model-supplied path. Anything that escapes the workspace root is rejected before any I/O. */
export function resolveInside(root: string, path: string): WorkspacePath {
  const absolute = resolve(root, path);
  if (!isInside(root, absolute)) throw new ToolFailure(`o caminho "${path}" sai do workspace`);
  return { absolute, relative: normalizePath(relative(root, absolute)) || "." };
}
