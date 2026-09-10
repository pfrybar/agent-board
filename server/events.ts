import type { BoardEvent } from "../shared/types.ts";
import { all, run, type Db } from "./db.ts";
import { iso, now } from "./util.ts";

export type EventActor = BoardEvent["actor"];

export interface NewEvent {
  type: string;
  actor: EventActor;
  /** The agent the event is about, if any. */
  agentId?: string | null;
  taskId?: string | null;
  detail?: string | null;
}

export function logEvent(db: Db, e: NewEvent): void {
  run(
    db,
    `INSERT INTO events (type, actor, agent_id, task_id, detail, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    e.type,
    e.actor,
    e.agentId ?? null,
    e.taskId ?? null,
    e.detail ?? null,
    now(),
  );
}

interface EventRow {
  id: number;
  type: string;
  actor: EventActor;
  agent_id: string | null;
  agent_name: string | null;
  task_id: string | null;
  detail: string | null;
  created_at: number;
}

/** Newest first. */
export function listEvents(
  db: Db,
  filter: { agentId?: string; taskId?: string; limit?: number } = {},
): BoardEvent[] {
  const where: string[] = [];
  const params: string[] = [];
  if (filter.agentId) {
    where.push("e.agent_id = ?");
    params.push(filter.agentId);
  }
  if (filter.taskId) {
    where.push("e.task_id = ?");
    params.push(filter.taskId);
  }
  const rows = all<EventRow>(
    db,
    `SELECT e.*, a.name AS agent_name
     FROM events e LEFT JOIN agents a ON a.id = e.agent_id
     ${where.length > 0 ? `WHERE ${where.join(" AND ")}` : ""}
     ORDER BY e.id DESC LIMIT ?`,
    ...params,
    filter.limit ?? 100,
  );
  return rows.map((r) => ({
    id: r.id,
    type: r.type,
    actor: r.actor,
    agent: r.agent_id === null ? null : { id: r.agent_id, name: r.agent_name ?? "(deleted agent)" },
    taskId: r.task_id,
    detail: r.detail,
    createdAt: iso(r.created_at),
  }));
}
