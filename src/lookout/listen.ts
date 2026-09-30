import type { Server } from "node:http";

const EXTRA_PORTS_TO_TRY = 9;

/** Listens on `port`; if it is taken, tries the next ones. Port 0 lets the OS pick. Resolves with the bound port. */
export function listen(server: Server, port: number, host: string): Promise<number> {
  return new Promise((resolve, reject) => {
    let retries = 0;
    const attempt = (candidate: number) => {
      const onError = (error: NodeJS.ErrnoException) => {
        server.off("listening", onListening);
        if (error.code === "EADDRINUSE" && candidate !== 0 && retries++ < EXTRA_PORTS_TO_TRY) attempt(candidate + 1);
        else reject(error);
      };
      const onListening = () => {
        server.off("error", onError);
        const address = server.address();
        resolve(typeof address === "object" && address ? address.port : candidate);
      };
      server.once("error", onError);
      server.once("listening", onListening);
      server.listen(candidate, host);
    };
    attempt(port);
  });
}
