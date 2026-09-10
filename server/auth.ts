import type { FastifyRequest } from "fastify";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { AgentRow } from "./agents.ts";
import { one, run, type Db } from "./db.ts";
import { ApiError, now } from "./util.ts";

declare module "fastify" {
  interface FastifyRequest {
    /** The authenticated agent, set by accessControl on /api/* routes. */
    agent?: AgentRow;
  }
}

export function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

// Agent keys -----------------------------------------------------------------

/** A new API key. Only its hash is stored; the key itself is shown once. */
export function generateKey(): { key: string; hash: string; prefix: string } {
  const key = `ab_${randomBytes(24).toString("base64url")}`;
  return { key, hash: sha256(key), prefix: key.slice(0, 8) };
}

/** last_seen_at is written at most this often per agent. */
const SEEN_WRITE_MS = 10_000;

/** Resolve an `Authorization: Bearer <key>` header to its agent, or null. */
export function authenticateAgent(db: Db, header: string | undefined): AgentRow | null {
  const match = /^Bearer\s+(\S+)\s*$/i.exec(header ?? "");
  if (!match) return null;
  const agent = one<AgentRow>(db, "SELECT * FROM agents WHERE key_hash = ?", sha256(match[1]));
  if (!agent) return null;
  const t = now();
  if (agent.last_seen_at === null || t - agent.last_seen_at >= SEEN_WRITE_MS) {
    run(db, "UPDATE agents SET last_seen_at = ? WHERE id = ?", t, agent.id);
    agent.last_seen_at = t;
  }
  return agent;
}

// Web UI sessions --------------------------------------------------------------

export const SESSION_COOKIE = "ab_session";
export const SESSION_MS = 12 * 60 * 60 * 1000;

export function passwordMatches(expected: string | undefined, given: unknown): boolean {
  if (!expected || typeof given !== "string") return false;
  // Comparing fixed-length digests keeps the comparison constant-time.
  return timingSafeEqual(Buffer.from(sha256(expected), "hex"), Buffer.from(sha256(given), "hex"));
}

/** Start a session; returns the cookie value. */
export function createSession(db: Db): string {
  const token = randomBytes(32).toString("base64url");
  run(db, "DELETE FROM sessions WHERE expires_at < ?", now());
  run(
    db,
    "INSERT INTO sessions (token_hash, expires_at) VALUES (?, ?)",
    sha256(token),
    now() + SESSION_MS,
  );
  return token;
}

export function hasSession(db: Db, token: string | undefined): boolean {
  if (!token) return false;
  const row = one(
    db,
    "SELECT 1 FROM sessions WHERE token_hash = ? AND expires_at > ?",
    sha256(token),
    now(),
  );
  return row !== undefined;
}

export function endSession(db: Db, token: string | undefined): void {
  if (token) run(db, "DELETE FROM sessions WHERE token_hash = ?", sha256(token));
}

export function readCookie(header: string | undefined, name: string): string | undefined {
  for (const part of (header ?? "").split(";")) {
    const [key, ...value] = part.trim().split("=");
    if (key === name) return value.join("=");
  }
  return undefined;
}

// Access control -------------------------------------------------------------

/**
 * Routes anyone may call: signing in, and the web UI's page and assets
 * (they have to load before you can sign in). Nothing else is public.
 */
export const PUBLIC_ROUTES = new Set(["/admin/login", "/*"]);

/**
 * The one gate every request passes. It goes by the route that matched,
 * not the raw URL, so an encoded path can't slip past it.
 *
 * - `/api/*` needs an agent key: `Authorization: Bearer <key>`.
 * - `/admin/*` needs a web UI session. Requests other than GET also need
 *   `X-Requested-With: agent-board`: a cross-site page can't add that
 *   header without a CORS preflight, which this server never approves,
 *   so together with the SameSite=Strict cookie it stops CSRF.
 * - Any other route is refused unless it's in PUBLIC_ROUTES.
 *
 * Requests that match no route go on to the 404 handler.
 */
export function accessControl(db: Db) {
  return async (req: FastifyRequest): Promise<void> => {
    const route = req.routeOptions.url;
    if (!route) return;
    const isAdmin = route.startsWith("/admin/");
    if (isAdmin && req.method !== "GET" && req.method !== "HEAD" && req.headers["x-requested-with"] !== "agent-board") {
      throw new ApiError(403, "forbidden", "missing header X-Requested-With: agent-board");
    }
    if (PUBLIC_ROUTES.has(route)) return;
    if (route.startsWith("/api/")) {
      const agent = authenticateAgent(db, req.headers.authorization);
      if (!agent) {
        throw new ApiError(401, "unauthorized", "missing or invalid API key (send Authorization: Bearer <key>)");
      }
      req.agent = agent;
      return;
    }
    if (isAdmin && hasSession(db, readCookie(req.headers.cookie, SESSION_COOKIE))) return;
    throw new ApiError(401, "unauthorized", "sign in first");
  };
}
