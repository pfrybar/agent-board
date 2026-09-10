/**
 * Types shared by the server and the web UI: the JSON shapes on the wire.
 * Timestamps are ISO-8601 UTC strings.
 */

export type TaskStatus =
  | "pending" // waiting for an agent to claim it
  | "claimed" // an agent is working on it
  | "needs_input" // the worker asked a question and is waiting for an answer
  | "completed"
  | "failed"
  | "cancelled";

export interface AgentRef {
  id: string;
  name: string;
}

export interface Task {
  id: string;
  title: string | null;
  prompt: string;
  status: TaskStatus;
  /** Only this agent may claim the task. Null: any agent may. */
  assignedTo: AgentRef | null;
  /** The agent working on the task, or the one that finished it. Null while pending. */
  claimedBy: AgentRef | null;
  /** The agent that submitted the task. Null: the supervisor did. */
  createdBy: AgentRef | null;
  /** The result when completed, or the reason when failed. */
  result: string | null;
  claimedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Message {
  id: number;
  authorType: "agent" | "supervisor";
  /** The agent that wrote it. Null for the supervisor. */
  author: AgentRef | null;
  body: string;
  isQuestion: boolean;
  createdAt: string;
}

export interface TaskDetail extends Task {
  messages: Message[];
}

/** One page of the task list, newest first. */
export interface TaskPage {
  tasks: Task[];
  /** How many tasks match the filter, across all pages. */
  total: number;
}

export interface Agent {
  id: string;
  name: string;
  description: string | null;
  /** Allowed to submit tasks through the API. Every agent can receive them. */
  canSend: boolean;
  /** False once the key is revoked: the agent can't authenticate. */
  hasKey: boolean;
  /** First characters of the key, to tell keys apart. Never the full key. */
  keyPrefix: string | null;
  keyCreatedAt: string | null;
  lastSeenAt: string | null;
  /** Tasks it is working on right now (claimed or needs_input). */
  activeTasks: number;
  createdAt: string;
}

export interface BoardEvent {
  id: number;
  type: string;
  actor: "agent" | "supervisor" | "system";
  /** The agent the event is about, if any. */
  agent: AgentRef | null;
  taskId: string | null;
  detail: string | null;
  createdAt: string;
}

export interface Overview {
  tasks: Record<TaskStatus, number> & { total: number };
}

export interface ApiError {
  error: string;
  code: string;
}
