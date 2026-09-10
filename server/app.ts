import fastifyStatic from "@fastify/static";
import Fastify, { type FastifyInstance } from "fastify";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { adminApi } from "./admin-api.ts";
import { agentApi } from "./agent-api.ts";
import { accessControl } from "./auth.ts";
import type { Config } from "./config.ts";
import { openDb, type Db } from "./db.ts";
import { requeueStale } from "./tasks.ts";
import { ApiError } from "./util.ts";

/** Build the app without listening, so tests can use inject(). */
export async function buildApp(config: Config, db: Db = openDb(config.dbPath)): Promise<FastifyInstance> {
  const app = Fastify({ bodyLimit: 1024 * 1024 });

  // Accept an empty body with a JSON content-type: agents calling from a
  // shell often send that header on every request, body or not.
  const parseJson = app.getDefaultJsonParser("error", "error");
  app.removeContentTypeParser("application/json");
  app.addContentTypeParser("application/json", { parseAs: "string" }, (req, body, done) => {
    const text = typeof body === "string" ? body : body.toString("utf8");
    if (text === "") return done(null, undefined);
    parseJson(req, text, done);
  });

  app.setErrorHandler((err: Error & { statusCode?: number }, _req, reply) => {
    if (err instanceof ApiError) {
      return reply.code(err.status).send({ error: err.message, code: err.code });
    }
    const status = err.statusCode ?? 500;
    if (status < 500) {
      // Fastify's own request errors: malformed JSON, body too large, ...
      return reply.code(status).send({ error: err.message, code: "bad_request" });
    }
    console.error(err);
    return reply.code(500).send({ error: "internal error", code: "internal" });
  });

  // Every request passes this gate before any route runs.
  app.addHook("onRequest", accessControl(db));

  await app.register(agentApi, { db });
  await app.register(adminApi, { db, config });

  if (existsSync(join(config.webDist, "index.html"))) {
    await app.register(fastifyStatic, { root: config.webDist });
  }
  app.setNotFoundHandler((_req, reply) => reply.code(404).send({ error: "not found", code: "not_found" }));

  if (config.requeueAfterMs > 0) {
    const timer = setInterval(() => requeueStale(db, config.requeueAfterMs), 60_000);
    timer.unref();
    app.addHook("onClose", async () => clearInterval(timer));
  }
  app.addHook("onClose", async () => db.close());

  return app;
}
