import { dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { listDir, readText } from "../util/fs.ts";

const PUBLIC_DIR = join(dirname(fileURLToPath(import.meta.url)), "public");

const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
};

export interface Asset {
  body: string;
  contentType: string;
}

/**
 * Serves only files that exist in `public/` and `public/js/` when the server starts.
 * The allowlist is built from the folder itself, so a request path can never escape it.
 */
export class Assets {
  private readonly allowed: Map<string, string>;

  constructor(dir: string = PUBLIC_DIR) {
    this.allowed = new Map([["/", join(dir, "index.html")]]);
    for (const file of listDir(dir)) if (CONTENT_TYPES[extname(file)]) this.allowed.set(`/${file}`, join(dir, file));
    for (const file of listDir(join(dir, "js"))) if (extname(file) === ".js") this.allowed.set(`/js/${file}`, join(dir, "js", file));
  }

  get(pathname: string): Asset | null {
    const file = this.allowed.get(pathname);
    const body = file ? readText(file) : null;
    return file && body !== null ? { body, contentType: CONTENT_TYPES[extname(file)] } : null;
  }
}
