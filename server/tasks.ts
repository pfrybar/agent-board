/**
 * Every task state change lives here. Each one runs in a single
 * transaction and logs its event in that transaction.
 *
 * A claimed task belongs to its worker until the worker finishes it or
 * the supervisor requeues it; claims never expire on their own. Only the
 * current worker can complete or fail a task, so after a requeue the old
 * worker's late result is rejected (409 not_your_task).
 */
import type { Message, Overview, Task, TaskDetail, TaskStatus } from "../shared/types.ts";
import { all, one, run, tx, type Db } from "./db.ts";
import { logEvent } from "./events.ts";
import { ApiError, iso, newId, now, optionalText, text } from "./util.ts";

/** Who is making a change: the supervisor (web UI) or an authenticated agent. */
export type Actor = { type: "supervisor" } | { type: "agent"; agentId: string };

export const STATUSES: TaskStatus[] = [
  "pending",
  "claimed",
  "needs_input",
  "completed",
  "failed",
  "cancelled",
];
/** Statuses in which a task has a worker. */
const ACTIVE: TaskStatus[] = ["claimed", "needs_input"];
const LIMITS = { title: 200, prompt: 100_000, result: 100_000, message: 20_000 };

interface TaskRow {
  id: string;
  title: string | null;
  prompt: string;
  status: TaskStatus;
  assigned_to: string | null;
  claimed_by: string | null;
  created_by: string | null;
  result: string | null;
  claimed_at: number | null;
  created_at: number;
  updated_at: number;
  assigned_name: string | null;
  claimed_name: string | null;
  created_name: string | null;
}

interface MessageRow {
  id: number;
  author_type: "agent" | "supervisor";
  agent_id: string | null;
  agent_name: string | null;
  body: string;
  is_question: number;
  created_at: number;
}

const SELECT_TASK = `
  SELECT t.*,
    assignee.name AS assigned_name,
    worker.name AS claimed_name,
    creator.name AS created_name
  FROM tasks t
  LEFT JOIN agents assignee ON assignee.id = t.assigned_to
  LEFT JOIN agents worker ON worker.id = t.claimed_by
  LEFT JOIN agents creator ON creator.id = t.created_by`;

function ref(id: string | null, name: string | null) {
  return id === null ? null : { id, name: name ?? "(deleted agent)" };
}

function toTask(row: TaskRow): Task {
  return {
    id: row.id,
    title: row.title,
    prompt: row.prompt,
    status: row.status,
    assignedTo: ref(row.assigned_to, row.assigned_name),
    claimedBy: ref(row.claimed_by, row.claimed_name),
    createdBy: ref(row.created_by, row.created_name),
    result: row.result,
    claimedAt: iso(row.claimed_at),
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
}

function loadRow(db: Db, id: string): TaskRow {
  const row = one<TaskRow>(db, `${SELECT_TASK} WHERE t.id = ?`, id);
  if (!row) throw new ApiError(404, "task_not_found", "task not found");
  return row;
}

/**
 * Load a task the actor may see. Agents see tasks they created, are
 * assigned to, or are working on; anything else is a 404.
 */
function visibleRow(db: Db, id: string, actor: Actor): TaskRow {
  const row = loadRow(db, id);
  if (actor.type === "agent") {
    const me = actor.agentId;
    if (row.created_by !== me && row.assigned_to !== me && row.claimed_by !== me) {
      throw new ApiError(404, "task_not_found", "task not found");
    }
  }
  return row;
}

function detail(db: Db, id: string): TaskDetail {
  const messages = all<MessageRow>(
    db,
    `SELECT m.*, a.name AS agent_name
     FROM messages m LEFT JOIN agents a ON a.id = m.agent_id
     WHERE m.task_id = ? ORDER BY m.id`,
    id,
  ).map(
    (m): Message => ({
      id: m.id,
      authorType: m.author_type,
      author: ref(m.agent_id, m.agent_name),
      body: m.body,
      isQuestion: m.is_question === 1,
      createdAt: iso(m.created_at),
    }),
  );
  return { ...toTask(loadRow(db, id)), messages };
}

function agentByName(db: Db, value: unknown): { id: string; name: string } {
  const name = text(value, "assignTo", 64).trim();
  const agent = one<{ id: string; name: string }>(db, "SELECT id, name FROM agents WHERE name = ?", name);
  if (!agent) throw new ApiError(400, "unknown_agent", `no agent named "${name}"`);
  return agent;
}

function actorAgentId(actor: Actor): string | null {
  return actor.type === "agent" ? actor.agentId : null;
}

// Creating and claiming ------------------------------------------------------

export function createTask(
  db: Db,
  actor: Actor,
  input: { title?: unknown; prompt?: unknown; assignTo?: unknown },
): TaskDetail {
  const title = optionalText(input.title, "title", LIMITS.title);
  const prompt = text(input.prompt, "prompt", LIMITS.prompt);
  const assignee =
    input.assignTo === undefined || input.assignTo === null || input.assignTo === ""
      ? null
      : agentByName(db, input.assignTo);
  const id = newId("t");
  const t = now();
  return tx(db, () => {
    run(
      db,
      `INSERT INTO tasks (id, title, prompt, assigned_to, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      id,
      title,
      prompt,
      assignee?.id ?? null,
      actorAgentId(actor),
      t,
      t,
    );
    logEvent(db, {
      type: "task_created",
      actor: actor.type,
      agentId: actorAgentId(actor),
      taskId: id,
      detail: assignee ? `for ${assignee.name}` : null,
    });
    return detail(db, id);
  });
}

/**
 * Claim the agent's next task: the oldest one assigned to it, otherwise
 * the oldest one open to any agent. Returns null when there is nothing.
 */
export function claimNext(db: Db, agentId: string): TaskDetail | null {
  const t = now();
  return tx(db, () => {
    const [claimed] = all<{ id: string }>(
      db,
      `UPDATE tasks SET status = 'claimed', claimed_by = ?, claimed_at = ?, updated_at = ?
       WHERE id = (
         SELECT id FROM tasks
         WHERE status = 'pending' AND (assigned_to IS NULL OR assigned_to = ?)
         ORDER BY assigned_to IS NULL, created_at, rowid
         LIMIT 1
       )
       RETURNING id`,
      agentId,
      t,
      t,
      agentId,
    );
    if (!claimed) return null;
    logEvent(db, { type: "task_claimed", actor: "agent", agentId, taskId: claimed.id });
    return detail(db, claimed.id);
  });
}

// Reading --------------------------------------------------------------------

export function getTask(db: Db, id: string, actor: Actor): TaskDetail {
  visibleRow(db, id, actor);
  return detail(db, id);
}

/** `agentId` matches tasks the agent created, is assigned, or worked on. */
export interface TaskFilter {
  status?: TaskStatus;
  agentId?: string;
}

function taskWhere(filter: TaskFilter): { sql: string; params: string[] } {
  const where: string[] = [];
  const params: string[] = [];
  if (filter.status) {
    where.push("t.status = ?");
    params.push(filter.status);
  }
  if (filter.agentId) {
    where.push("(t.claimed_by = ? OR t.assigned_to = ? OR t.created_by = ?)");
    params.push(filter.agentId, filter.agentId, filter.agentId);
  }
  return { sql: where.length > 0 ? `WHERE ${where.join(" AND ")}` : "", params };
}

/** One page of tasks, newest first. Ties keep insertion order, so pages are stable. */
export function listTasks(
  db: Db,
  filter: TaskFilter & { limit?: number; offset?: number } = {},
): Task[] {
  const where = taskWhere(filter);
  return all<TaskRow>(
    db,
    `${SELECT_TASK} ${where.sql}
     ORDER BY t.created_at DESC, t.rowid DESC LIMIT ? OFFSET ?`,
    ...where.params,
    filter.limit ?? 100,
    filter.offset ?? 0,
  ).map(toTask);
}

/** How many tasks match the filter, across all pages. */
export function countTasks(db: Db, filter: TaskFilter = {}): number {
  const where = taskWhere(filter);
  return one<{ n: number }>(db, `SELECT COUNT(*) AS n FROM tasks t ${where.sql}`, ...where.params)?.n ?? 0;
}

/** What an agent has on its plate: tasks it's working on, and tasks it submitted. */
export function listAgentWork(db: Db, agentId: string): { working: Task[]; created: Task[] } {
  return {
    working: all<TaskRow>(
      db,
      `${SELECT_TASK} WHERE t.claimed_by = ? AND t.status IN ('claimed', 'needs_input')
       ORDER BY t.claimed_at`,
      agentId,
    ).map(toTask),
    created: all<TaskRow>(
      db,
      `${SELECT_TASK} WHERE t.created_by = ? ORDER BY t.created_at DESC, t.rowid DESC LIMIT 50`,
      agentId,
    ).map(toTask),
  };
}

export function taskCounts(db: Db): Overview["tasks"] {
  const counts = Object.fromEntries(STATUSES.map((s) => [s, 0])) as Record<TaskStatus, number>;
  const rows = all<{ status: TaskStatus; n: number }>(
    db,
    "SELECT status, COUNT(*) AS n FROM tasks GROUP BY status",
  );
  let total = 0;
  for (const r of rows) {
    counts[r.status] = r.n;
    total += r.n;
  }
  return { ...counts, total };
}

// Conversation ---------------------------------------------------------------

/**
 * Post a message on a task. The worker may mark it as a question: the task
 * becomes needs_input but stays with the worker. A reply from anyone else
 * (the creator or the supervisor) hands it back: needs_input -> claimed.
 */
export function postMessage(
  db: Db,
  actor: Actor,
  taskId: string,
  input: { body?: unknown; question?: unknown },
): TaskDetail {
  const body = text(input.body, "body", LIMITS.message);
  if (input.question !== undefined && typeof input.question !== "boolean") {
    throw new ApiError(400, "validation", "question must be true or false");
  }
  const isQuestion = input.question === true;
  return tx(db, () => {
    const row = visibleRow(db, taskId, actor);
    const agentId = actorAgentId(actor);
    const isWorker = agentId !== null && row.claimed_by === agentId && ACTIVE.includes(row.status);
    if (agentId !== null && !isWorker && row.created_by !== agentId) {
      throw new ApiError(
        403,
        "not_participant",
        "only the agent working on this task or the agent that created it can post messages",
      );
    }
    if (isQuestion && !isWorker) {
      throw new ApiError(403, "not_worker", "only the agent working on this task can ask a question");
    }

    const t = now();
    run(
      db,
      `INSERT INTO messages (task_id, author_type, agent_id, body, is_question, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      taskId,
      actor.type,
      agentId,
      body,
      isQuestion ? 1 : 0,
      t,
    );
    let status = row.status;
    let type = "message_posted";
    if (isQuestion) {
      status = "needs_input";
      type = "question_asked";
    } else if (row.status === "needs_input" && !isWorker) {
      status = "claimed";
      type = "question_answered";
    }
    run(db, "UPDATE tasks SET status = ?, updated_at = ? WHERE id = ?", status, t, taskId);
    logEvent(db, { type, actor: actor.type, agentId, taskId });
    return detail(db, taskId);
  });
}

// Finishing ------------------------------------------------------------------

/** Complete or fail a task. Only its current worker can. */
export function finishTask(
  db: Db,
  agentId: string,
  taskId: string,
  outcome: "completed" | "failed",
  value: unknown,
): TaskDetail {
  const result = text(value, outcome === "completed" ? "result" : "reason", LIMITS.result);
  return tx(db, () => {
    const row = loadRow(db, taskId);
    if (row.claimed_by !== agentId || !ACTIVE.includes(row.status)) {
      // Visible or not, say why: the likely caller is a worker whose task
      // was requeued or cancelled while it was busy.
      throw new ApiError(
        409,
        "not_your_task",
        `this task is not assigned to you any more (status: ${row.status}); stop working on it`,
      );
    }
    run(
      db,
      "UPDATE tasks SET status = ?, result = ?, updated_at = ? WHERE id = ?",
      outcome,
      result,
      now(),
      taskId,
    );
    logEvent(db, {
      type: outcome === "completed" ? "task_completed" : "task_failed",
      actor: "agent",
      agentId,
      taskId,
      // Requeueing clears the result, so keep the reason for a failure here.
      detail: outcome === "failed" ? result.slice(0, 1000) : null,
    });
    return detail(db, taskId);
  });
}

/** Cancel an unfinished task: the supervisor, or the agent that created it. */
export function cancelTask(db: Db, actor: Actor, taskId: string): TaskDetail {
  return tx(db, () => {
    const row = visibleRow(db, taskId, actor);
    if (actor.type === "agent" && row.created_by !== actor.agentId) {
      throw new ApiError(403, "not_creator", "only the agent that created this task can cancel it");
    }
    if (row.status !== "pending" && !ACTIVE.includes(row.status)) {
      throw new ApiError(409, "not_cancellable", `task is already ${row.status}`);
    }
    run(db, "UPDATE tasks SET status = 'cancelled', updated_at = ? WHERE id = ?", now(), taskId);
    logEvent(db, { type: "task_cancelled", actor: actor.type, agentId: actorAgentId(actor), taskId });
    return detail(db, taskId);
  });
}

// Requeueing (supervisor) ----------------------------------------------------

/**
 * Put a task back in the queue, whatever its status. The current worker,
 * if any, loses it. `assignTo`: an agent name, null for any agent, or
 * omitted to keep the current assignment. The conversation is kept.
 */
export function requeueTask(db: Db, taskId: string, input: { assignTo?: unknown }): TaskDetail {
  return tx(db, () => {
    const row = loadRow(db, taskId);
    let assignee = ref(row.assigned_to, row.assigned_name);
    if (input.assignTo !== undefined) {
      assignee = input.assignTo === null || input.assignTo === "" ? null : agentByName(db, input.assignTo);
    }
    run(
      db,
      `UPDATE tasks SET status = 'pending', assigned_to = ?, claimed_by = NULL,
         claimed_at = NULL, result = NULL, updated_at = ?
       WHERE id = ?`,
      assignee?.id ?? null,
      now(),
      taskId,
    );
    logEvent(db, {
      type: "task_requeued",
      actor: "supervisor",
      agentId: row.claimed_by,
      taskId,
      detail: `was ${row.status}; now ${assignee ? `for ${assignee.name}` : "open to any agent"}`,
    });
    return detail(db, taskId);
  });
}

/**
 * Requeue claimed tasks whose worker has made no request, and whose task
 * hasn't changed, for `idleMs`. Opt-in (REQUEUE_AFTER_MINUTES): a worker
 * doing long work without calling in is indistinguishable from a dead one.
 * Tasks waiting on an answer (needs_input) are left alone.
 */
export function requeueStale(db: Db, idleMs: number): number {
  const cutoff = now() - idleMs;
  const stale = all<{ id: string; claimed_by: string }>(
    db,
    `SELECT t.id, t.claimed_by FROM tasks t
     LEFT JOIN agents a ON a.id = t.claimed_by
     WHERE t.status = 'claimed' AND MAX(COALESCE(a.last_seen_at, 0), t.updated_at) < ?`,
    cutoff,
  );
  let requeued = 0;
  for (const task of stale) {
    tx(db, () => {
      const changed = run(
        db,
        `UPDATE tasks SET status = 'pending', claimed_by = NULL, claimed_at = NULL, updated_at = ?
         WHERE id = ? AND status = 'claimed' AND claimed_by = ?`,
        now(),
        task.id,
        task.claimed_by,
      );
      if (changed === 0) return;
      requeued += 1;
      logEvent(db, {
        type: "task_requeued",
        actor: "system",
        agentId: task.claimed_by,
        taskId: task.id,
        detail: `worker silent for over ${Math.round(idleMs / 60_000)} min`,
      });
    });
  }
  return requeued;
}
