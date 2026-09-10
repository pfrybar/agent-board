import type { Agent } from "../shared/types.ts";
import { generateKey } from "./auth.ts";
import { all, one, run, tx, type Db } from "./db.ts";
import { logEvent } from "./events.ts";
import { ApiError, iso, newId, now, optionalText } from "./util.ts";

export interface AgentRow {
  id: string;
  name: string;
  description: string | null;
  can_send: number;
  key_hash: string | null;
  key_prefix: string | null;
  key_created_at: number | null;
  last_seen_at: number | null;
  created_at: number;
}

const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const DESCRIPTION_MAX = 1000;

const SELECT_AGENT = `
  SELECT a.*,
    (SELECT COUNT(*) FROM tasks t
     WHERE t.claimed_by = a.id AND t.status IN ('claimed', 'needs_input')) AS active_tasks
  FROM agents a`;

function toAgent(row: AgentRow & { active_tasks: number }): Agent {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    canSend: row.can_send === 1,
    hasKey: row.key_hash !== null,
    keyPrefix: row.key_prefix,
    keyCreatedAt: iso(row.key_created_at),
    lastSeenAt: iso(row.last_seen_at),
    activeTasks: row.active_tasks,
    createdAt: iso(row.created_at),
  };
}

function booleanField(value: unknown, field: string): boolean | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "boolean") throw new ApiError(400, "validation", `${field} must be true or false`);
  return value;
}

export function listAgents(db: Db): Agent[] {
  return all<AgentRow & { active_tasks: number }>(db, `${SELECT_AGENT} ORDER BY a.name`).map(toAgent);
}

export function getAgent(db: Db, id: string): Agent {
  const row = one<AgentRow & { active_tasks: number }>(db, `${SELECT_AGENT} WHERE a.id = ?`, id);
  if (!row) throw new ApiError(404, "agent_not_found", "agent not found");
  return toAgent(row);
}

/** Register an agent and issue its first key. The key is returned only here. */
export function createAgent(
  db: Db,
  input: { name?: unknown; description?: unknown; canSend?: unknown },
): { agent: Agent; key: string } {
  const name = typeof input.name === "string" ? input.name.trim() : "";
  if (!NAME_RE.test(name)) {
    throw new ApiError(
      400,
      "validation",
      "name must be 1-64 letters, digits, dots, dashes or underscores, starting with a letter or digit",
    );
  }
  const description = optionalText(input.description, "description", DESCRIPTION_MAX);
  const canSend = booleanField(input.canSend, "canSend") ?? false;
  if (one(db, "SELECT 1 FROM agents WHERE name = ?", name)) {
    throw new ApiError(409, "name_taken", `an agent named "${name}" already exists`);
  }
  const id = newId("a");
  const { key, hash, prefix } = generateKey();
  const t = now();
  tx(db, () => {
    run(
      db,
      `INSERT INTO agents (id, name, description, can_send, key_hash, key_prefix, key_created_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      id,
      name,
      description,
      canSend ? 1 : 0,
      hash,
      prefix,
      t,
      t,
    );
    logEvent(db, { type: "agent_created", actor: "supervisor", agentId: id });
  });
  return { agent: getAgent(db, id), key };
}

export function updateAgent(
  db: Db,
  id: string,
  input: { description?: unknown; canSend?: unknown },
): Agent {
  getAgent(db, id);
  const canSend = booleanField(input.canSend, "canSend");
  const changes: string[] = [];
  tx(db, () => {
    if (input.description !== undefined) {
      const description = optionalText(input.description, "description", DESCRIPTION_MAX);
      run(db, "UPDATE agents SET description = ? WHERE id = ?", description, id);
      changes.push("description updated");
    }
    if (canSend !== undefined) {
      run(db, "UPDATE agents SET can_send = ? WHERE id = ?", canSend ? 1 : 0, id);
      changes.push(canSend ? "can send tasks" : "can no longer send tasks");
    }
    if (changes.length > 0) {
      logEvent(db, { type: "agent_updated", actor: "supervisor", agentId: id, detail: changes.join("; ") });
    }
  });
  return getAgent(db, id);
}

/**
 * Delete an agent. Refused while it has work in progress or tasks waiting
 * for it; its name stays on finished tasks as "(deleted agent)".
 */
export function deleteAgent(db: Db, id: string): void {
  const agent = getAgent(db, id);
  const open = one<{ n: number }>(
    db,
    `SELECT COUNT(*) AS n FROM tasks
     WHERE (claimed_by = ? AND status IN ('claimed', 'needs_input'))
        OR (assigned_to = ? AND status = 'pending')`,
    id,
    id,
  );
  if (open && open.n > 0) {
    throw new ApiError(
      409,
      "agent_busy",
      `${agent.name} has ${open.n} open task(s); requeue or cancel them first`,
    );
  }
  tx(db, () => {
    run(db, "DELETE FROM agents WHERE id = ?", id);
    logEvent(db, { type: "agent_deleted", actor: "supervisor", agentId: id, detail: agent.name });
  });
}

/** Issue a new key, replacing any current one. Returns the key (shown once). */
export function issueKey(db: Db, id: string): string {
  getAgent(db, id);
  const { key, hash, prefix } = generateKey();
  tx(db, () => {
    run(
      db,
      "UPDATE agents SET key_hash = ?, key_prefix = ?, key_created_at = ? WHERE id = ?",
      hash,
      prefix,
      now(),
      id,
    );
    logEvent(db, { type: "key_issued", actor: "supervisor", agentId: id });
  });
  return key;
}

export function revokeKey(db: Db, id: string): void {
  getAgent(db, id);
  tx(db, () => {
    run(
      db,
      "UPDATE agents SET key_hash = NULL, key_prefix = NULL, key_created_at = NULL WHERE id = ?",
      id,
    );
    logEvent(db, { type: "key_revoked", actor: "supervisor", agentId: id });
  });
}
