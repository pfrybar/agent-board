import type {
  Agent,
  BoardEvent,
  Overview,
  Task,
  TaskDetail,
  TaskPage,
  TaskStatus,
} from "../../shared/types.ts";

export type { Agent, BoardEvent, Task, TaskDetail, TaskStatus };

export class ApiException extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "ApiException";
    this.status = status;
  }
}

let unauthorizedHandler: (() => void) | null = null;

/** The app shell registers this to return to the sign-in screen on 401. */
export function onUnauthorized(fn: (() => void) | null): void {
  unauthorizedHandler = fn;
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  // The server refuses web UI mutations without this header (CSRF protection).
  const headers: Record<string, string> = { "x-requested-with": "agent-board" };
  if (body !== undefined) headers["content-type"] = "application/json";
  let res: Response;
  try {
    res = await fetch(path, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      credentials: "same-origin",
    });
  } catch {
    throw new ApiException(0, "Can't reach the server");
  }
  if (res.status === 401 && path !== "/admin/login") unauthorizedHandler?.();
  if (!res.ok) {
    let message = res.statusText;
    try {
      const data = (await res.json()) as { error?: string };
      if (data.error) message = data.error;
    } catch {
      // Not JSON: keep the status text.
    }
    throw new ApiException(res.status, message);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

const enc = encodeURIComponent;

/** Every call the web UI makes to the server. */
export const api = {
  session: () => request<{ ok: true }>("GET", "/admin/session"),
  login: (password: string) => request<{ ok: true }>("POST", "/admin/login", { password }),
  logout: () => request<{ ok: true }>("POST", "/admin/logout"),
  overview: () => request<Overview>("GET", "/admin/overview"),

  agents: () => request<{ agents: Agent[] }>("GET", "/admin/agents"),
  agent: (id: string) =>
    request<{ agent: Agent; tasks: Task[]; events: BoardEvent[] }>("GET", `/admin/agents/${enc(id)}`),
  createAgent: (input: { name: string; description?: string; canSend: boolean }) =>
    request<{ agent: Agent; key: string }>("POST", "/admin/agents", input),
  updateAgent: (id: string, input: { description?: string | null; canSend?: boolean }) =>
    request<{ agent: Agent }>("PATCH", `/admin/agents/${enc(id)}`, input),
  deleteAgent: (id: string) => request<void>("DELETE", `/admin/agents/${enc(id)}`),
  issueKey: (id: string) => request<{ key: string }>("POST", `/admin/agents/${enc(id)}/key`),
  revokeKey: (id: string) => request<void>("DELETE", `/admin/agents/${enc(id)}/key`),

  tasks: (params: { status?: TaskStatus; limit?: number; offset?: number } = {}) => {
    const query = new URLSearchParams();
    if (params.status) query.set("status", params.status);
    if (params.limit !== undefined) query.set("limit", String(params.limit));
    if (params.offset !== undefined) query.set("offset", String(params.offset));
    const qs = query.toString();
    return request<TaskPage>("GET", `/admin/tasks${qs ? `?${qs}` : ""}`);
  },
  task: (id: string) =>
    request<{ task: TaskDetail; events: BoardEvent[] }>("GET", `/admin/tasks/${enc(id)}`),
  createTask: (input: { title?: string; prompt: string; assignTo?: string }) =>
    request<{ task: TaskDetail }>("POST", "/admin/tasks", input),
  postMessage: (id: string, body: string) =>
    request<{ task: TaskDetail }>("POST", `/admin/tasks/${enc(id)}/messages`, { body }),
  cancelTask: (id: string) => request<{ task: TaskDetail }>("POST", `/admin/tasks/${enc(id)}/cancel`),
  requeueTask: (id: string, assignTo: string | null) =>
    request<{ task: TaskDetail }>("POST", `/admin/tasks/${enc(id)}/requeue`, { assignTo }),

  events: (agentId?: string) =>
    request<{ events: BoardEvent[] }>("GET", `/admin/events${agentId ? `?agentId=${enc(agentId)}` : ""}`),
};
