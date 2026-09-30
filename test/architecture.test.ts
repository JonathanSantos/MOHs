import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { normalizePath } from "../src/util/glob.ts";

const SRC = fileURLToPath(new URL("../src/", import.meta.url));

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? sourceFiles(join(dir, entry.name)) : entry.name.endsWith(".ts") ? [join(dir, entry.name)] : [],
  );
}

/** Relative imports of a file, resolved to paths inside `src/`. */
function importsOf(file: string): string[] {
  const text = readFileSync(file, "utf8");
  return [...text.matchAll(/from "(\.[^"]+)"/g)].map((match) => normalizePath(relative(SRC, resolve(dirname(file), match[1]))));
}

describe("architecture", () => {
  it("keeps the core agnostic: only the CLI knows the drivers", () => {
    const offenders = sourceFiles(SRC)
      .map((file) => normalizePath(relative(SRC, file)))
      .filter((file) => !file.startsWith("drivers/") && !file.startsWith("cli/"))
      .flatMap((file) =>
        importsOf(join(SRC, file))
          .filter((target) => target.startsWith("drivers/"))
          .map((target) => `${file} → ${target}`),
      );
    assert.deepEqual(offenders, []);
  });

  it("keeps each driver to itself", () => {
    const offenders = sourceFiles(join(SRC, "drivers")).flatMap((file) => {
      const [, own] = normalizePath(relative(SRC, file)).split("/");
      return importsOf(file)
        .filter((target) => target.startsWith("drivers/") && target.split("/")[1] !== own)
        .map((target) => `${normalizePath(relative(SRC, file))} → ${target}`);
    });
    assert.deepEqual(offenders, []);
  });
});
