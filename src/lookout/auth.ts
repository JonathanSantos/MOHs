import type { IncomingMessage } from "node:http";

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

/**
 * A WebSocket upgrade needs the session key and, when a browser sends Origin, it must be this
 * same Lookout. Otherwise any page open in the browser could sign lines on the user's behalf.
 */
export function isAuthorizedUpgrade(request: IncomingMessage, key: string, port: number): boolean {
  const url = new URL(request.url ?? "/", "http://localhost");
  if (url.pathname !== "/ws" || url.searchParams.get("key") !== key) return false;

  const origin = request.headers.origin;
  if (!origin) return true;
  try {
    const { hostname, port: originPort } = new URL(origin);
    return LOOPBACK_HOSTS.has(hostname) && Number(originPort || 80) === port;
  } catch {
    return false;
  }
}
