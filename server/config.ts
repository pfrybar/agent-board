import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export interface Config {
  port: number;
  host: string;
  dbPath: string;
  /** Web UI password. When unset, sign-in is disabled. */
  supervisorPassword: string | undefined;
  /** Mark the session cookie Secure (set when serving over HTTPS). */
  cookieSecure: boolean;
  /** Requeue claimed tasks whose worker has been silent this long. 0 = never. */
  requeueAfterMs: number;
  /** The built web UI, served when present. */
  webDist: string;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const num = (key: string, fallback: number): number => {
    const raw = env[key];
    if (raw === undefined || raw === "") return fallback;
    const n = Number(raw);
    if (!Number.isFinite(n) || n < 0) {
      throw new Error(`${key} must be a non-negative number, got "${raw}"`);
    }
    return n;
  };
  return {
    port: num("PORT", 3001),
    host: env.HOST || "127.0.0.1",
    dbPath: env.DB_PATH || "./data/agent-board.db",
    supervisorPassword: env.SUPERVISOR_PASSWORD || undefined,
    cookieSecure: env.COOKIE_SECURE === "1",
    requeueAfterMs: num("REQUEUE_AFTER_MINUTES", 0) * 60_000,
    webDist: env.WEB_DIST
      ? resolve(env.WEB_DIST)
      : fileURLToPath(new URL("../web/dist", import.meta.url)),
  };
}
