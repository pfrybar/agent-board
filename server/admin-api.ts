import type { FastifyPluginAsync } from "fastify";
import type { TaskStatus } from "../shared/types.ts";
import {
  createAgent,
  deleteAgent,
  getAgent,
  issueKey,
  listAgents,
  revokeKey,
  updateAgent,
} from "./agents.ts";
import {
  SESSION_COOKIE,
  SESSION_MS,
  createSession,
  endSession,
  passwordMatches,
  readCookie,
} from "./auth.ts";
import type { Config } from "./config.ts";
import type { Db } from "./db.ts";
import { listEvents } from "./events.ts";
import {
  STATUSES,
  cancelTask,
  countTasks,
  createTask,
  getTask,
  listTasks,
  postMessage,
  requeueTask,
  taskCounts,
  type Actor,
} from "./tasks.ts";
import { ApiError, bodyOf, limitParam, offsetParam } from "./util.ts";

type IdParams = { Params: { id: string } };

const SUPERVISOR: Actor = { type: "supervisor" };
const MAX_FAILED_LOGINS_PER_MINUTE = 10;

/**
 * The web UI's API. Signing in with the password sets a session cookie;
 * accessControl (auth.ts) requires that session on every other route.
 */
export const adminApi: FastifyPluginAsync<{ db: Db; config: Config }> = async (app, { db, config }) => {
  const cookie = (value: string, maxAgeSec: number): string =>
    [
      `${SESSION_COOKIE}=${value}`,
      "HttpOnly",
      "Path=/",
      "SameSite=Strict",
      `Max-Age=${maxAgeSec}`,
      ...(config.cookieSecure ? ["Secure"] : []),
    ].join("; ");

  // Session

  const failedLogins = new Map<string, { count: number; since: number }>();

  app.post("/admin/login", async (req, reply) => {
    if (!config.supervisorPassword) {
      throw new ApiError(503, "login_disabled", "sign-in is disabled: set SUPERVISOR_PASSWORD on the server");
    }
    const t = Date.now();
    const failed = failedLogins.get(req.ip);
    const recent = failed && t - failed.since < 60_000 ? failed : undefined;
    if (recent && recent.count >= MAX_FAILED_LOGINS_PER_MINUTE) {
      throw new ApiError(429, "rate_limited", "too many failed sign-in attempts; wait a minute");
    }
    if (!passwordMatches(config.supervisorPassword, bodyOf(req.body).password)) {
      failedLogins.set(req.ip, recent ? { count: recent.count + 1, since: recent.since } : { count: 1, since: t });
      throw new ApiError(401, "wrong_password", "wrong password");
    }
    failedLogins.delete(req.ip);
    reply.header("set-cookie", cookie(createSession(db), SESSION_MS / 1000));
    return { ok: true };
  });

  app.post("/admin/logout", async (req, reply) => {
    endSession(db, readCookie(req.headers.cookie, SESSION_COOKIE));
    reply.header("set-cookie", cookie("", 0));
    return { ok: true };
  });

  app.get("/admin/session", async () => ({ ok: true }));
  app.get("/admin/overview", async () => ({ tasks: taskCounts(db) }));

  // Agents

  app.get("/admin/agents", async () => ({ agents: listAgents(db) }));

  app.post("/admin/agents", async (req, reply) => reply.code(201).send(createAgent(db, bodyOf(req.body))));

  app.get<IdParams>("/admin/agents/:id", async (req) => ({
    agent: getAgent(db, req.params.id),
    tasks: listTasks(db, { agentId: req.params.id, limit: 50 }),
    events: listEvents(db, { agentId: req.params.id, limit: 50 }),
  }));

  app.patch<IdParams>("/admin/agents/:id", async (req) => ({
    agent: updateAgent(db, req.params.id, bodyOf(req.body)),
  }));

  app.delete<IdParams>("/admin/agents/:id", async (req, reply) => {
    deleteAgent(db, req.params.id);
    return reply.code(204).send();
  });

  app.post<IdParams>("/admin/agents/:id/key", async (req) => ({ key: issueKey(db, req.params.id) }));

  app.delete<IdParams>("/admin/agents/:id/key", async (req, reply) => {
    revokeKey(db, req.params.id);
    return reply.code(204).send();
  });

  // Tasks

  app.get<{ Querystring: { status?: string; limit?: string; offset?: string } }>(
    "/admin/tasks",
    async (req) => {
      const { status, limit, offset } = req.query;
      if (status !== undefined && !STATUSES.includes(status as TaskStatus)) {
        throw new ApiError(400, "validation", `unknown status "${status}"`);
      }
      const filter = { status: status as TaskStatus | undefined };
      return {
        tasks: listTasks(db, { ...filter, limit: limitParam(limit, 100), offset: offsetParam(offset) }),
        total: countTasks(db, filter),
      };
    },
  );

  app.post("/admin/tasks", async (req, reply) =>
    reply.code(201).send({ task: createTask(db, SUPERVISOR, bodyOf(req.body)) }),
  );

  app.get<IdParams>("/admin/tasks/:id", async (req) => ({
    task: getTask(db, req.params.id, SUPERVISOR),
    events: listEvents(db, { taskId: req.params.id, limit: 200 }),
  }));

  app.post<IdParams>("/admin/tasks/:id/messages", async (req) => ({
    task: postMessage(db, SUPERVISOR, req.params.id, { body: bodyOf(req.body).body }),
  }));

  app.post<IdParams>("/admin/tasks/:id/cancel", async (req) => ({
    task: cancelTask(db, SUPERVISOR, req.params.id),
  }));

  app.post<IdParams>("/admin/tasks/:id/requeue", async (req) => ({
    task: requeueTask(db, req.params.id, bodyOf(req.body)),
  }));

  // Activity

  app.get<{ Querystring: { agentId?: string; limit?: string } }>("/admin/events", async (req) => ({
    events: listEvents(db, {
      agentId: req.query.agentId || undefined,
      limit: limitParam(req.query.limit, 100),
    }),
  }));
};
