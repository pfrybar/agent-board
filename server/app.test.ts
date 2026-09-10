import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { buildApp } from "./app.ts";
import type { Config } from "./config.ts";
import { openDb, run } from "./db.ts";
import { requeueStale } from "./tasks.ts";

type Method = "GET" | "POST" | "PATCH" | "DELETE";

const PASSWORD = "correct horse";
const CSRF = { "x-requested-with": "agent-board" };

async function setup(t: TestContext, overrides: Partial<Config> = {}) {
  const config: Config = {
    port: 0,
    host: "127.0.0.1",
    dbPath: ":memory:",
    supervisorPassword: PASSWORD,
    cookieSecure: false,
    requeueAfterMs: 0,
    webDist: "/nonexistent",
    ...overrides,
  };
  const db = openDb(":memory:");
  const app = await buildApp(config, db);
  t.after(() => app.close());

  const login = await app.inject({ method: "POST", url: "/admin/login", headers: CSRF, payload: { password: PASSWORD } });
  const cookie = String(login.headers["set-cookie"] ?? "").split(";")[0];

  /** Call the web UI's API, signed in. */
  const admin = (method: Method, url: string, payload?: object) =>
    app.inject({ method, url, headers: { ...CSRF, cookie }, payload });

  /** Call the agent API with a key. */
  const withKey = (key: string) => (method: Method, url: string, payload?: object) =>
    app.inject({ method, url, headers: { authorization: `Bearer ${key}` }, payload });

  const newAgent = async (name: string, canSend = false) => {
    const res = await admin("POST", "/admin/agents", { name, canSend });
    assert.equal(res.statusCode, 201, res.body);
    const { agent, key } = res.json();
    return { id: agent.id as string, key: key as string, call: withKey(key) };
  };

  const newTask = async (payload: object) => {
    const res = await admin("POST", "/admin/tasks", payload);
    assert.equal(res.statusCode, 201, res.body);
    return res.json().task;
  };

  return { app, db, cookie, admin, withKey, newAgent, newTask };
}

test("the agent API rejects missing, unknown, replaced and revoked keys", async (t) => {
  const { app, admin, withKey, newAgent } = await setup(t);
  const bot = await newAgent("bot");

  assert.equal((await app.inject({ method: "GET", url: "/api/me" })).statusCode, 401);
  assert.equal((await withKey("ab_not-a-real-key")("GET", "/api/me")).statusCode, 401);
  const me = await bot.call("GET", "/api/me");
  assert.equal(me.statusCode, 200);
  assert.deepEqual(me.json(), { id: bot.id, name: "bot", canSend: false });

  const replacement = (await admin("POST", `/admin/agents/${bot.id}/key`)).json().key;
  assert.equal((await bot.call("GET", "/api/me")).statusCode, 401);
  assert.equal((await withKey(replacement)("GET", "/api/me")).statusCode, 200);

  assert.equal((await admin("DELETE", `/admin/agents/${bot.id}/key`)).statusCode, 204);
  assert.equal((await withKey(replacement)("GET", "/api/me")).statusCode, 401);
});

test("keys are only ever shown when issued", async (t) => {
  const { admin, newAgent } = await setup(t);
  const bot = await newAgent("bot");
  assert.match(bot.key, /^ab_[A-Za-z0-9_-]{32}$/);

  const detail = await admin("GET", `/admin/agents/${bot.id}`);
  assert.ok(!detail.body.includes(bot.key));
  assert.equal(detail.json().agent.keyPrefix, bot.key.slice(0, 8));
  assert.ok(!(await admin("GET", "/admin/agents")).body.includes(bot.key));
});

test("agent names are validated and unique regardless of case", async (t) => {
  const { admin, newAgent } = await setup(t);
  await newAgent("bot");
  const taken = await admin("POST", "/admin/agents", { name: "BOT" });
  assert.equal(taken.statusCode, 409);
  assert.equal(taken.json().code, "name_taken");
  assert.equal((await admin("POST", "/admin/agents", { name: "has space" })).statusCode, 400);
});

test("only agents allowed to send can create tasks", async (t) => {
  const { newAgent } = await setup(t);
  const worker = await newAgent("worker");
  const boss = await newAgent("boss", true);

  const denied = await worker.call("POST", "/api/tasks", { prompt: "hi" });
  assert.equal(denied.statusCode, 403);
  assert.equal(denied.json().code, "cannot_send");

  const created = await boss.call("POST", "/api/tasks", { prompt: "Summarize the logs", assignTo: "worker" });
  assert.equal(created.statusCode, 201);
  const task = created.json().task;
  assert.equal(task.status, "pending");
  assert.deepEqual(task.createdBy, { id: boss.id, name: "boss" });
  assert.deepEqual(task.assignedTo, { id: worker.id, name: "worker" });

  const unknown = await boss.call("POST", "/api/tasks", { prompt: "x", assignTo: "ghost" });
  assert.equal(unknown.json().code, "unknown_agent");
  assert.equal((await boss.call("POST", "/api/tasks", { prompt: "   " })).statusCode, 400);
});

test("claiming gives an agent its assigned tasks first, then the pool", async (t) => {
  const { newAgent, newTask } = await setup(t);
  const a = await newAgent("a");
  const b = await newAgent("b");
  const pool = await newTask({ prompt: "anyone" });
  const forB = await newTask({ prompt: "for b", assignTo: "b" });

  // b's assigned task comes first even though the pool task is older.
  assert.equal((await b.call("POST", "/api/tasks/next")).json().task.id, forB.id);

  const claimed = (await a.call("POST", "/api/tasks/next")).json().task;
  assert.equal(claimed.id, pool.id);
  assert.equal(claimed.status, "claimed");
  assert.deepEqual(claimed.claimedBy, { id: a.id, name: "a" });

  // Each task goes to exactly one agent.
  assert.deepEqual((await a.call("POST", "/api/tasks/next")).json(), { task: null });
  assert.deepEqual((await b.call("POST", "/api/tasks/next")).json(), { task: null });

  const work = (await a.call("GET", "/api/tasks")).json();
  assert.deepEqual(
    work.working.map((task: { id: string }) => task.id),
    [pool.id],
  );
});

test("only the worker can complete or fail a task, once", async (t) => {
  const { newAgent, newTask } = await setup(t);
  const a = await newAgent("a");
  const b = await newAgent("b");
  const first = await newTask({ prompt: "one" });
  const second = await newTask({ prompt: "two" });
  await a.call("POST", "/api/tasks/next");

  const stranger = await b.call("POST", `/api/tasks/${first.id}/complete`, { result: "mine" });
  assert.equal(stranger.statusCode, 409);
  assert.equal(stranger.json().code, "not_your_task");
  assert.equal((await a.call("POST", `/api/tasks/${first.id}/complete`, {})).statusCode, 400);

  const done = await a.call("POST", `/api/tasks/${first.id}/complete`, { result: "all done" });
  assert.equal(done.statusCode, 200);
  assert.equal(done.json().task.status, "completed");
  assert.equal(done.json().task.result, "all done");
  assert.equal((await a.call("POST", `/api/tasks/${first.id}/complete`, { result: "again" })).statusCode, 409);

  await a.call("POST", "/api/tasks/next");
  const failed = await a.call("POST", `/api/tasks/${second.id}/fail`, { reason: "no access" });
  assert.equal(failed.json().task.status, "failed");
  assert.equal(failed.json().task.result, "no access");
});

test("a worker's question goes to the creator and the task stays with the worker", async (t) => {
  const { admin, newAgent } = await setup(t);
  const worker = await newAgent("worker");
  const boss = await newAgent("boss", true);
  const task = (await boss.call("POST", "/api/tasks", { prompt: "Book a room" })).json().task;
  await worker.call("POST", "/api/tasks/next");

  const asked = await worker.call("POST", `/api/tasks/${task.id}/messages`, { body: "Which city?", question: true });
  assert.equal(asked.json().task.status, "needs_input");
  const seen = (await boss.call("GET", `/api/tasks/${task.id}`)).json().task;
  assert.equal(seen.messages[0].isQuestion, true);

  // Only the worker asks questions.
  const bossQuestion = await boss.call("POST", `/api/tasks/${task.id}/messages`, { body: "?", question: true });
  assert.equal(bossQuestion.statusCode, 403);

  const answered = await boss.call("POST", `/api/tasks/${task.id}/messages`, { body: "Paris" });
  assert.equal(answered.json().task.status, "claimed");
  const reread = (await worker.call("GET", `/api/tasks/${task.id}`)).json().task;
  assert.deepEqual(reread.claimedBy, { id: worker.id, name: "worker" });
  assert.equal(reread.messages.at(-1).body, "Paris");
  assert.deepEqual(reread.messages.at(-1).author, { id: boss.id, name: "boss" });

  // The supervisor can answer too.
  await worker.call("POST", `/api/tasks/${task.id}/messages`, { body: "Budget?", question: true });
  const fromSupervisor = await admin("POST", `/admin/tasks/${task.id}/messages`, { body: "200 EUR" });
  assert.equal(fromSupervisor.json().task.status, "claimed");
  assert.equal(fromSupervisor.json().task.messages.at(-1).authorType, "supervisor");
});

test("requeue takes a task from its worker and keeps the conversation", async (t) => {
  const { admin, newAgent, newTask } = await setup(t);
  const a = await newAgent("a");
  const b = await newAgent("b");
  const task = await newTask({ prompt: "Investigate" });
  await a.call("POST", "/api/tasks/next");
  await a.call("POST", `/api/tasks/${task.id}/messages`, { body: "Halfway there" });

  const requeued = (await admin("POST", `/admin/tasks/${task.id}/requeue`, { assignTo: "b" })).json().task;
  assert.equal(requeued.status, "pending");
  assert.equal(requeued.claimedBy, null);
  assert.deepEqual(requeued.assignedTo, { id: b.id, name: "b" });

  const late = await a.call("POST", `/api/tasks/${task.id}/complete`, { result: "done" });
  assert.equal(late.statusCode, 409);
  assert.equal(late.json().code, "not_your_task");
  assert.deepEqual((await a.call("POST", "/api/tasks/next")).json(), { task: null });

  const reclaimed = (await b.call("POST", "/api/tasks/next")).json().task;
  assert.equal(reclaimed.id, task.id);
  assert.equal(reclaimed.messages[0].body, "Halfway there");
});

test("the creator can cancel; the worker's result is then rejected", async (t) => {
  const { newAgent } = await setup(t);
  const worker = await newAgent("worker");
  const boss = await newAgent("boss", true);
  const outsider = await newAgent("outsider");
  const task = (await boss.call("POST", "/api/tasks", { prompt: "x", assignTo: "worker" })).json().task;
  await worker.call("POST", "/api/tasks/next");

  assert.equal((await outsider.call("POST", `/api/tasks/${task.id}/cancel`)).statusCode, 404);
  assert.equal((await worker.call("POST", `/api/tasks/${task.id}/cancel`)).statusCode, 403);
  assert.equal((await boss.call("POST", `/api/tasks/${task.id}/cancel`)).json().task.status, "cancelled");

  assert.equal((await worker.call("POST", `/api/tasks/${task.id}/complete`, { result: "y" })).statusCode, 409);
  const again = await boss.call("POST", `/api/tasks/${task.id}/cancel`);
  assert.equal(again.statusCode, 409);
  assert.equal(again.json().code, "not_cancellable");
});

test("agents only see tasks they created, are assigned, or work on", async (t) => {
  const { newAgent, newTask } = await setup(t);
  const a = await newAgent("a");
  const b = await newAgent("b");
  const task = await newTask({ prompt: "x" });
  assert.equal((await a.call("GET", `/api/tasks/${task.id}`)).statusCode, 404);
  await a.call("POST", "/api/tasks/next");
  assert.equal((await a.call("GET", `/api/tasks/${task.id}`)).statusCode, 200);
  assert.equal((await b.call("GET", `/api/tasks/${task.id}`)).statusCode, 404);
  assert.equal((await b.call("POST", `/api/tasks/${task.id}/messages`, { body: "hi" })).statusCode, 404);
});

test("the board's task list pages newest first and reports the total", async (t) => {
  const { admin, newTask } = await setup(t);
  const created = [];
  for (let i = 1; i <= 5; i++) created.push(await newTask({ prompt: `task ${i}` }));
  const page = async (query: string) => (await admin("GET", `/admin/tasks?${query}`)).json();
  const prompts = (res: { tasks: Array<{ prompt: string }> }) => res.tasks.map((task) => task.prompt);

  const first = await page("limit=2");
  assert.equal(first.total, 5);
  assert.deepEqual(prompts(first), ["task 5", "task 4"]);
  assert.deepEqual(prompts(await page("limit=2&offset=2")), ["task 3", "task 2"]);
  assert.deepEqual(prompts(await page("limit=2&offset=4")), ["task 1"]);
  const beyond = await page("limit=2&offset=6");
  assert.deepEqual(beyond.tasks, []);
  assert.equal(beyond.total, 5);

  // The total counts only tasks matching the filter.
  await admin("POST", `/admin/tasks/${created[0].id}/cancel`);
  const cancelled = await page("status=cancelled");
  assert.equal(cancelled.total, 1);
  assert.deepEqual(prompts(cancelled), ["task 1"]);

  assert.equal((await admin("GET", "/admin/tasks?offset=-1")).statusCode, 400);
  assert.equal((await admin("GET", "/admin/tasks?offset=abc")).statusCode, 400);
});

test("a JSON content-type with no body is fine; malformed JSON is a 400", async (t) => {
  const { app, newAgent } = await setup(t);
  const a = await newAgent("a");
  const headers = { authorization: `Bearer ${a.key}`, "content-type": "application/json" };

  const empty = await app.inject({ method: "POST", url: "/api/tasks/next", headers });
  assert.equal(empty.statusCode, 200);
  assert.deepEqual(empty.json(), { task: null });

  const malformed = await app.inject({ method: "POST", url: "/api/tasks/next", headers, payload: "{not json" });
  assert.equal(malformed.statusCode, 400);
  assert.equal(malformed.json().code, "bad_request");
});

test("the web UI API needs a session and the CSRF header", async (t) => {
  const { app, cookie, admin } = await setup(t);
  const login = (password: string) =>
    app.inject({ method: "POST", url: "/admin/login", headers: CSRF, payload: { password } });

  assert.equal((await app.inject({ method: "GET", url: "/admin/agents" })).statusCode, 401);
  assert.equal((await login("nope")).statusCode, 401);
  const noHeader = await app.inject({ method: "POST", url: "/admin/login", payload: { password: PASSWORD } });
  assert.equal(noHeader.statusCode, 403);

  assert.equal((await admin("GET", "/admin/agents")).statusCode, 200);
  const forged = await app.inject({ method: "POST", url: "/admin/agents", headers: { cookie }, payload: { name: "x" } });
  assert.equal(forged.statusCode, 403);

  await admin("POST", "/admin/logout");
  assert.equal((await admin("GET", "/admin/agents")).statusCode, 401);

  for (let i = 0; i < 10; i++) await login("nope");
  assert.equal((await login(PASSWORD)).statusCode, 429);
});

test("sign-in is disabled when no password is configured", async (t) => {
  const { app } = await setup(t, { supervisorPassword: undefined });
  const res = await app.inject({ method: "POST", url: "/admin/login", headers: CSRF, payload: { password: "" } });
  assert.equal(res.statusCode, 503);
});

test("auto-requeue takes back tasks whose worker went silent", async (t) => {
  const { db, admin, newAgent, newTask } = await setup(t);
  const a = await newAgent("a");
  const silent = await newTask({ prompt: "one" });
  const waiting = await newTask({ prompt: "two" });
  await a.call("POST", "/api/tasks/next");
  await a.call("POST", "/api/tasks/next");
  await a.call("POST", `/api/tasks/${waiting.id}/messages`, { body: "?", question: true });

  const hourAgo = Date.now() - 60 * 60_000;
  run(db, "UPDATE agents SET last_seen_at = ?", hourAgo);
  run(db, "UPDATE tasks SET updated_at = ?", hourAgo);
  assert.equal(requeueStale(db, 30 * 60_000), 1);

  const after = (await admin("GET", `/admin/tasks/${silent.id}`)).json();
  assert.equal(after.task.status, "pending");
  assert.equal(after.task.claimedBy, null);
  assert.equal(after.events[0].type, "task_requeued");
  assert.equal(after.events[0].actor, "system");
  // A worker waiting for an answer is not stale.
  assert.equal((await admin("GET", `/admin/tasks/${waiting.id}`)).json().task.status, "needs_input");
});

test("an agent can be deleted once its work is done; its history stays", async (t) => {
  const { admin, newAgent, newTask } = await setup(t);
  const a = await newAgent("a");
  const task = await newTask({ prompt: "x" });
  await a.call("POST", "/api/tasks/next");

  const busy = await admin("DELETE", `/admin/agents/${a.id}`);
  assert.equal(busy.statusCode, 409);
  assert.equal(busy.json().code, "agent_busy");

  await a.call("POST", `/api/tasks/${task.id}/complete`, { result: "ok" });
  assert.equal((await admin("DELETE", `/admin/agents/${a.id}`)).statusCode, 204);
  const after = (await admin("GET", `/admin/tasks/${task.id}`)).json().task;
  assert.equal(after.status, "completed");
  assert.deepEqual(after.claimedBy, { id: a.id, name: "(deleted agent)" });
  assert.equal((await a.call("GET", "/api/me")).statusCode, 401);
});

/** Parse `app.printRoutes({ commonPrefix: false })` into method + URL pairs. */
function listRoutes(tree: string): Array<{ method: string; url: string }> {
  const routes: Array<{ method: string; url: string }> = [];
  const path: string[] = [];
  for (const line of tree.split("\n")) {
    const match = /^([│ ]*)[├└]── (\S+)(?: \(([A-Z, ]+)\))?$/.exec(line);
    if (!match) continue;
    path.length = match[1].length / 4;
    path.push(match[2]);
    for (const method of match[3]?.split(", ") ?? []) routes.push({ method, url: path.join("") });
  }
  return routes;
}

test("every route refuses callers without the right credentials, except sign-in", async (t) => {
  type AnyMethod = Method | "HEAD";
  const { app, cookie, newAgent } = await setup(t);
  const agent = await newAgent("a");
  const routes = listRoutes(app.printRoutes({ commonPrefix: false }));
  assert.ok(routes.length >= 30, `found only ${routes.length} routes; did the printRoutes format change?`);

  const publicRoutes = new Set(["POST /admin/login"]);
  for (const { method, url } of routes) {
    const route = `${method} ${url}`;
    if (publicRoutes.has(route)) continue;
    const request = { method: method as AnyMethod, url: url.replaceAll(/:\w+/g, "x_000000000000") };

    const anonymous = await app.inject({ ...request, headers: CSRF });
    assert.equal(anonymous.statusCode, 401, `${route} answered ${anonymous.statusCode} without credentials`);

    // A key doesn't open the web UI's API, and a session doesn't open the agent API.
    const wrong = url.startsWith("/api/") ? { ...CSRF, cookie } : { ...CSRF, authorization: `Bearer ${agent.key}` };
    const mismatched = await app.inject({ ...request, headers: wrong });
    assert.equal(mismatched.statusCode, 401, `${route} answered ${mismatched.statusCode} with the wrong credential`);
  }
});
