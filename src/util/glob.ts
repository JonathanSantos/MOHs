const compiled = new Map<string, RegExp>();

/** Paths are compared with `/` on every platform. */
export function normalizePath(path: string): string {
  return path.replace(/\\/g, "/").replace(/^\.\//, "");
}

export function matchGlob(path: string, glob: string): boolean {
  return globToRegExp(normalizePath(glob)).test(normalizePath(path));
}

/** How many literal characters precede the first wildcard. Used to rank how specific a glob is. */
export function literalPrefixLength(glob: string): number {
  const firstWildcard = glob.search(/[*?[{]/);
  return firstWildcard === -1 ? glob.length : firstWildcard;
}

export interface GlobMatch {
  glob: string;
  file: string;
  specificity: number;
}

export function bestMatch(files: readonly string[], globs: readonly string[]): GlobMatch | null {
  let best: GlobMatch | null = null;
  for (const glob of globs) {
    for (const file of files) {
      if (!matchGlob(file, glob)) continue;
      const specificity = literalPrefixLength(glob);
      if (!best || specificity > best.specificity) best = { glob, file, specificity };
    }
  }
  return best;
}

/** Supports `**`, `*`, `?`, `{a,b}` and `[abc]`. */
export function globToRegExp(glob: string): RegExp {
  const cached = compiled.get(glob);
  if (cached) return cached;

  let source = "^";
  let openGroups = 0;
  for (let i = 0; i < glob.length; i++) {
    const char = glob[i];

    if (char === "*" && glob[i + 1] === "*") {
      // `**/` no início de um segmento também casa com zero pastas: `**/*.tsx` casa `App.tsx`.
      const startsSegment = i === 0 || glob[i - 1] === "/";
      if (startsSegment && glob[i + 2] === "/") {
        source += "(?:.*/)?";
        i += 2;
      } else {
        source += ".*";
        i += 1;
      }
    } else if (char === "*") source += "[^/]*";
    else if (char === "?") source += "[^/]";
    else if (char === "{") {
      openGroups++;
      source += "(?:";
    } else if (char === "}" && openGroups > 0) {
      openGroups--;
      source += ")";
    } else if (char === "," && openGroups > 0) source += "|";
    else if (char === "[" && glob.indexOf("]", i + 1) > i) {
      const end = glob.indexOf("]", i + 1);
      source += `[${glob
        .slice(i + 1, end)
        .replace(/^!/, "^")
        .replace(/\\/g, "\\\\")}]`;
      i = end;
    } else source += char.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
  }

  const regexp = new RegExp(`${source}$`);
  compiled.set(glob, regexp);
  return regexp;
}
