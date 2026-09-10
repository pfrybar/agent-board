import { useState, type ReactNode } from "react";
import type { BoardEvent, Task, TaskStatus } from "./api.ts";
import { humanize, isQuiet, presenceOf, timeAgo, type Presence } from "./format.ts";

export const inputClass =
  "w-full rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-500 focus:border-sky-500 focus:outline-none";

export const buttonPrimary =
  "rounded-md bg-sky-600 px-4 py-2 text-sm font-medium text-white hover:bg-sky-500 disabled:cursor-not-allowed disabled:opacity-50";

export const buttonSecondary =
  "rounded-md border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-sm text-zinc-200 hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-50";

export const buttonDanger =
  "rounded-md border border-red-500/40 bg-red-500/10 px-3 py-1.5 text-sm text-red-200 hover:bg-red-500/20 disabled:cursor-not-allowed disabled:opacity-50";

export function Card({
  title,
  tone = "default",
  children,
}: {
  title?: string;
  tone?: "default" | "warning";
  children: ReactNode;
}) {
  const border = tone === "warning" ? "border-amber-500/40" : "border-zinc-800";
  return (
    <div className={`rounded-lg border ${border} bg-zinc-900/60 p-4`}>
      {title && <h2 className="mb-3 text-sm font-semibold text-zinc-200">{title}</h2>}
      {children}
    </div>
  );
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-zinc-400">{label}</span>
      {children}
    </label>
  );
}

export function Spinner() {
  return (
    <div className="flex items-center justify-center py-12" aria-label="loading">
      <div className="h-6 w-6 animate-spin rounded-full border-2 border-zinc-700 border-t-zinc-300" />
    </div>
  );
}

export function ErrorBox({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">
      <p>{message}</p>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="mt-2 rounded-md bg-red-500/20 px-3 py-1 text-xs font-medium hover:bg-red-500/30"
        >
          Retry
        </button>
      )}
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-lg border border-dashed border-zinc-700 px-4 py-12 text-center text-sm text-zinc-500">
      {children}
    </div>
  );
}

const TAG_TONES = {
  zinc: "bg-zinc-800 text-zinc-300",
  sky: "bg-sky-500/15 text-sky-300",
  amber: "bg-amber-500/15 text-amber-300",
  red: "bg-red-500/15 text-red-300",
};

export function Tag({ tone = "zinc", children }: { tone?: keyof typeof TAG_TONES; children: ReactNode }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs ${TAG_TONES[tone]}`}>
      {children}
    </span>
  );
}

const STATUS_STYLES: Record<TaskStatus, string> = {
  pending: "bg-sky-500/15 text-sky-300 ring-sky-500/30",
  claimed: "bg-violet-500/15 text-violet-300 ring-violet-500/30",
  needs_input: "bg-amber-500/15 text-amber-300 ring-amber-500/30",
  completed: "bg-emerald-500/15 text-emerald-300 ring-emerald-500/30",
  failed: "bg-red-500/15 text-red-300 ring-red-500/30",
  cancelled: "bg-zinc-500/15 text-zinc-400 ring-zinc-500/30",
};

export const STATUS_LABELS: Record<TaskStatus, string> = {
  pending: "pending",
  claimed: "claimed",
  needs_input: "needs input",
  completed: "completed",
  failed: "failed",
  cancelled: "cancelled",
};

export function StatusBadge({ status }: { status: TaskStatus }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${STATUS_STYLES[status]}`}
    >
      {STATUS_LABELS[status]}
    </span>
  );
}

export const PRESENCE_DOT: Record<Presence, string> = {
  active: "bg-emerald-400",
  idle: "bg-amber-400",
  offline: "bg-zinc-600",
};

const PRESENCE_LABEL: Record<Presence, string> = { active: "Active", idle: "Idle", offline: "Offline" };

export function PresenceBadge({ lastSeenAt }: { lastSeenAt: string | null }) {
  const presence = presenceOf(lastSeenAt);
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-zinc-400">
      <span className={`inline-block h-2 w-2 rounded-full ${PRESENCE_DOT[presence]}`} />
      {lastSeenAt ? `${PRESENCE_LABEL[presence]} · seen ${timeAgo(lastSeenAt)}` : "Never connected"}
    </span>
  );
}

/**
 * One task in a list. Pass `workerLastSeen` to flag a claimed task whose
 * worker has gone quiet.
 */
export function TaskRow({ task, workerLastSeen }: { task: Task; workerLastSeen?: string | null }) {
  const quiet = task.status === "claimed" && workerLastSeen !== undefined && isQuiet(workerLastSeen);
  return (
    <a
      href={`#/tasks/${task.id}`}
      className="block rounded-lg border border-zinc-800 bg-zinc-900/60 px-4 py-3 hover:border-zinc-600"
    >
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate text-sm font-medium text-zinc-100">{task.title || task.prompt.slice(0, 80)}</div>
          <div className="mt-0.5 text-xs text-zinc-500">
            {task.id} · by {task.createdBy?.name ?? "supervisor"} · {timeAgo(task.createdAt)}
            {task.assignedTo && ` · for ${task.assignedTo.name}`}
            {task.claimedBy && ` · worker ${task.claimedBy.name}`}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {quiet && <Tag tone="amber">worker quiet · seen {timeAgo(workerLastSeen ?? null)}</Tag>}
          <StatusBadge status={task.status} />
        </div>
      </div>
    </a>
  );
}

function actorLabel(e: BoardEvent): string {
  if (e.actor === "agent") return e.agent?.name ?? "agent";
  return e.agent ? `${e.actor} · ${e.agent.name}` : e.actor;
}

/** A timeline of events, newest first. */
export function EventList({ events, showTask = false }: { events: BoardEvent[]; showTask?: boolean }) {
  if (events.length === 0) return <p className="text-sm text-zinc-500">Nothing yet.</p>;
  return (
    <ol className="space-y-2">
      {events.map((e) => (
        <li key={e.id} className="flex gap-3 text-xs">
          <span className="w-16 shrink-0 text-zinc-500">{timeAgo(e.createdAt)}</span>
          <div className="min-w-0">
            <span className="font-mono text-zinc-300">{humanize(e.type)}</span>
            <span className="text-zinc-500"> · {actorLabel(e)}</span>
            {showTask && e.taskId && (
              <a href={`#/tasks/${e.taskId}`} className="ml-2 font-mono text-sky-300 hover:underline">
                {e.taskId}
              </a>
            )}
            {e.detail && <p className="mt-0.5 whitespace-pre-wrap break-words text-zinc-500">{e.detail}</p>}
          </div>
        </li>
      ))}
    </ol>
  );
}

/** Shows a newly issued API key. It is never shown again. */
export function KeyReveal({ agentName, apiKey, onDone }: { agentName: string; apiKey: string; onDone: () => void }) {
  const [copied, setCopied] = useState(false);
  const example = `curl -X POST ${window.location.origin}/api/tasks/next \\\n  -H "Authorization: Bearer ${apiKey}"`;

  async function copy() {
    try {
      await navigator.clipboard.writeText(apiKey);
      setCopied(true);
    } catch {
      // Clipboard unavailable (e.g. plain HTTP): the key is still selectable.
    }
  }

  return (
    <Card tone="warning">
      <h2 className="text-sm font-semibold text-amber-200">API key for {agentName}: copy it now</h2>
      <p className="mt-1 text-xs text-zinc-400">
        This is the only time the key is shown. If it's lost, issue a new one.
      </p>
      <div className="mt-2 flex items-center gap-2">
        <code className="flex-1 break-all rounded bg-zinc-950 p-2 font-mono text-xs text-zinc-200">{apiKey}</code>
        <button type="button" onClick={copy} className={buttonSecondary}>
          {copied ? "Copied ✓" : "Copy"}
        </button>
      </div>
      <p className="mt-3 text-xs text-zinc-400">The agent asks for work like this:</p>
      <pre className="mt-1 overflow-x-auto rounded bg-zinc-950 p-2 text-xs text-zinc-300">{example}</pre>
      <button type="button" onClick={onDone} className={`${buttonSecondary} mt-3`}>
        Done
      </button>
    </Card>
  );
}
