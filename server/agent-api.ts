import type { FastifyPluginAsync, FastifyRequest } from "fastify";
import type { AgentRow } from "./agents.ts";
import type { Db } from "./db.ts";
import {
  cancelTask,
  claimNext,
  createTask,
  finishTask,
  getTask,
  listAgentWork,
  postMessage,
  type Actor,
} from "./tasks.ts";
import { ApiError, bodyOf } from "./util.ts";

type IdParams = { Params: { id: string } };

/**
 * The agent API. accessControl (auth.ts) checks the agent's key on every
 * route before it runs and sets `req.agent`.
 */
export const agentApi: FastifyPluginAsync<{ db: Db }> = async (app, { db }) => {
  const me = (req: FastifyRequest): AgentRow => req.agent!;
  const actor = (req: FastifyRequest): Actor => ({ type: "agent", agentId: me(req).id });

  app.get("/api/me", async (req) => ({
    id: me(req).id,
    name: me(req).name,
    canSend: me(req).can_send === 1,
  }));

  app.get("/api/tasks", async (req) => listAgentWork(db, me(req).id));

  app.post("/api/tasks/next", async (req) => ({ task: claimNext(db, me(req).id) }));

  app.get<IdParams>("/api/tasks/:id", async (req) => ({
    task: getTask(db, req.params.id, actor(req)),
  }));

  app.post("/api/tasks", async (req, reply) => {
    if (me(req).can_send !== 1) {
      throw new ApiError(403, "cannot_send", "this agent is not allowed to create tasks");
    }
    return reply.code(201).send({ task: createTask(db, actor(req), bodyOf(req.body)) });
  });

  app.post<IdParams>("/api/tasks/:id/complete", async (req) => ({
    task: finishTask(db, me(req).id, req.params.id, "completed", bodyOf(req.body).result),
  }));

  app.post<IdParams>("/api/tasks/:id/fail", async (req) => ({
    task: finishTask(db, me(req).id, req.params.id, "failed", bodyOf(req.body).reason),
  }));

  app.post<IdParams>("/api/tasks/:id/messages", async (req) => ({
    task: postMessage(db, actor(req), req.params.id, bodyOf(req.body)),
  }));

  app.post<IdParams>("/api/tasks/:id/cancel", async (req) => ({
    task: cancelTask(db, actor(req), req.params.id),
  }));
};
