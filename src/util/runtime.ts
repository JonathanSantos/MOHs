import { userInfo } from "node:os";

/** Resolves on the next macrotask when `ms` is zero or infinite-speed, so simulated work still yields. */
export function sleep(ms: number): Promise<void> {
  if (!Number.isFinite(ms) || ms <= 0) return new Promise((resolve) => setImmediate(resolve));
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Current OS user, portable across Windows (USERNAME), macOS and Linux (USER). */
export function currentUser(): string {
  try {
    return userInfo().username;
  } catch {
    return process.env.USER ?? process.env.USERNAME ?? "human";
  }
}

export function keepAlive(): Promise<never> {
  return new Promise<never>(() => {});
}
