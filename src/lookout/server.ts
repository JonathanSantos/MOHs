import { randomBytes } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { WebSocketServer } from "ws";
import { Assets } from "./assets.ts";
import { isAuthorizedUpgrade } from "./auth.ts";
import { handleCommand } from "./commands.ts";
import { ClimbHub, send } from "./hub.ts";
import { listen } from "./listen.ts";

export interface LookoutOptions {
  mohsDir: string;
  port?: number;
  host?: string;
  /** Session key required by the WebSocket and the API. Default: $MOHS_LOOKOUT_KEY or random. */
  key?: string;
  pollMs?: number;
}

export interface LookoutHandle {
  url: string;
  port: number;
  key: string;
  close(): Promise<void>;
}

const DEFAULTS = { host: "127.0.0.1", port: 4747, pollMs: 150 };

/** The live dashboard: static page + JSON snapshot + a WebSocket that streams every climb event. */
export async function startLookout(options: LookoutOptions): Promise<LookoutHandle> {
  const host = options.host ?? DEFAULTS.host;
  const key = options.key ?? process.env.MOHS_LOOKOUT_KEY ?? randomBytes(12).toString("base64url");
  const hub = new ClimbHub(options.mohsDir, options.pollMs ?? DEFAULTS.pollMs);
  const assets = new Assets();
  let port = options.port ?? DEFAULTS.port;

  const server = createServer((request, response) => serveHttp(request, response, { key, hub, assets, host }));
  const sockets = new WebSocketServer({ noServer: true });

  server.on("upgrade", (request, socket, head) => {
    if (!isAuthorizedUpgrade(request, key, port)) {
      socket.end("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n");
      return;
    }
    sockets.handleUpgrade(request, socket, head, (client) => {
      hub.connect(client);
      client.on("message", (raw) => {
        const outcome = handleCommand(String(raw), options.mohsDir, hub);
        send(client, outcome.ok ? { type: "ack", cmd: outcome.cmd ?? "" } : { type: "error", message: outcome.message });
      });
    });
  });

  port = await listen(server, port, host);
  return {
    url: `http://${host}:${port}/?key=${encodeURIComponent(key)}`,
    port,
    key,
    close: () =>
      new Promise<void>((resolve) => {
        hub.close();
        sockets.close();
        server.close(() => resolve());
      }),
  };
}

interface HttpContext {
  key: string;
  hub: ClimbHub;
  assets: Assets;
  host: string;
}

function serveHttp(request: IncomingMessage, response: ServerResponse, { key, hub, assets, host }: HttpContext): void {
  const url = new URL(request.url ?? "/", `http://${host}`);
  const noStore = { "cache-control": "no-store" };

  if (url.pathname === "/api/state") {
    const authorized = url.searchParams.get("key") === key;
    response
      .writeHead(authorized ? 200 : 401, { "content-type": "application/json", ...noStore })
      .end(JSON.stringify(authorized ? hub.snapshot() : { error: "chave inválida" }));
    return;
  }

  const asset = assets.get(url.pathname);
  if (!asset) {
    response.writeHead(404, { "content-type": "text/plain; charset=utf-8" }).end("não encontrado");
    return;
  }
  response.writeHead(200, { "content-type": asset.contentType, ...noStore }).end(asset.body);
}
