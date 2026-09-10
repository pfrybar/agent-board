-- Agent Board schema. Applied on every boot; every statement is idempotent.
-- Timestamps are INTEGER Unix milliseconds. Booleans are INTEGER 0/1.
--
-- Agent ids in tasks, messages, and events are deliberately not foreign
-- keys: history survives deleting an agent (its name shows as deleted).

CREATE TABLE IF NOT EXISTS agents (
  id             TEXT PRIMARY KEY,
  name           TEXT NOT NULL UNIQUE COLLATE NOCASE,
  description    TEXT,
  can_send       INTEGER NOT NULL DEFAULT 0,
  key_hash       TEXT UNIQUE,  -- sha256 of the API key; NULL = no working key
  key_prefix     TEXT,         -- first characters of the key, for display
  key_created_at INTEGER,
  last_seen_at   INTEGER,      -- last authenticated request
  created_at     INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS tasks (
  id          TEXT PRIMARY KEY,
  title       TEXT,
  prompt      TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'pending' CHECK (status IN
                ('pending', 'claimed', 'needs_input', 'completed', 'failed', 'cancelled')),
  assigned_to TEXT,     -- only this agent may claim it; NULL = any agent
  claimed_by  TEXT,     -- the agent working on it (kept after it finishes)
  created_by  TEXT,     -- the submitting agent; NULL = the supervisor
  result      TEXT,     -- the result, or the reason for failure
  claimed_at  INTEGER,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL,
  -- Pending tasks have no worker; tasks being worked on always have one.
  CHECK (
    CASE status
      WHEN 'pending' THEN claimed_by IS NULL
      WHEN 'claimed' THEN claimed_by IS NOT NULL
      WHEN 'needs_input' THEN claimed_by IS NOT NULL
      ELSE 1
    END
  )
);
CREATE INDEX IF NOT EXISTS idx_tasks_queue ON tasks(status, created_at);
CREATE INDEX IF NOT EXISTS idx_tasks_claimed_by ON tasks(claimed_by);
CREATE INDEX IF NOT EXISTS idx_tasks_created_by ON tasks(created_by);

-- The conversation on a task: questions, answers, and notes.
CREATE TABLE IF NOT EXISTS messages (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id     TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  author_type TEXT NOT NULL CHECK (author_type IN ('agent', 'supervisor')),
  agent_id    TEXT,     -- the author when author_type = 'agent'
  body        TEXT NOT NULL,
  is_question INTEGER NOT NULL DEFAULT 0,
  created_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_messages_task ON messages(task_id, id);

-- What happened, for the activity feed and task timelines.
CREATE TABLE IF NOT EXISTS events (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  type       TEXT NOT NULL,
  actor      TEXT NOT NULL CHECK (actor IN ('agent', 'supervisor', 'system')),
  agent_id   TEXT,      -- the agent the event is about, if any
  task_id    TEXT,
  detail     TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_events_task ON events(task_id, id);
CREATE INDEX IF NOT EXISTS idx_events_agent ON events(agent_id, id);

-- Web UI sign-in sessions. Only a hash of the cookie value is stored.
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  expires_at INTEGER NOT NULL
);
