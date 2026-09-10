import { useState } from "react";
import { api } from "../api.ts";
import { timeAgo } from "../format.ts";
import {
  buttonDanger,
  buttonPrimary,
  buttonSecondary,
  Card,
  ErrorBox,
  EventList,
  Field,
  inputClass,
  PresenceBadge,
  Spinner,
  StatusBadge,
  Tag,
} from "../ui.tsx";
import { useLoad } from "../useLoad.ts";

export default function TaskDetail({ id }: { id: string }) {
  const { data, error, loading, reload } = useLoad(
    async () => {
      const [detail, agents] = await Promise.all([api.task(id), api.agents()]);
      return { ...detail, agents: agents.agents };
    },
    [id],
    5000,
  );
  const [reply, setReply] = useState("");
  // null = the select shows the task's current assignment.
  const [assignTo, setAssignTo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    setActionError(null);
    try {
      await action();
      await reload();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Action failed");
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <Spinner />;
  if (!data) return <ErrorBox message={error ?? "Task not found"} onRetry={reload} />;

  const { task, events, agents } = data;
  const worker = task.claimedBy ? agents.find((a) => a.id === task.claimedBy?.id) : undefined;
  const active = task.status === "claimed" || task.status === "needs_input";
  const assignValue = assignTo ?? task.assignedTo?.name ?? "";

  let requeueLabel = "Run again";
  let requeueHint = "Puts the task back in the queue. The conversation is kept.";
  if (active) {
    requeueLabel = "Take back and requeue";
    requeueHint = `${task.claimedBy?.name ?? "The worker"} will no longer be able to submit a result. The conversation is kept.`;
  } else if (task.status === "pending") {
    requeueLabel = "Change assignment";
    requeueHint = "The task stays in the queue.";
  }

  return (
    <div className="space-y-4">
      <div>
        <a href="#/" className="text-xs text-zinc-500 hover:text-zinc-300">
          ← Back to board
        </a>
        <div className="mt-1 flex flex-wrap items-center gap-2">
          <h1 className="text-xl font-bold text-zinc-100">{task.title || "Untitled task"}</h1>
          <StatusBadge status={task.status} />
        </div>
        <p className="mt-1 text-xs text-zinc-500">
          {task.id} · created by {task.createdBy?.name ?? "supervisor"} {timeAgo(task.createdAt)} ·{" "}
          {task.assignedTo ? `for ${task.assignedTo.name}` : "any agent"} · updated {timeAgo(task.updatedAt)}
        </p>
        {task.claimedBy && (
          <p className="mt-1 flex flex-wrap items-center gap-2 text-xs text-zinc-400">
            <span>
              {active ? "Worker" : "Worked on by"}{" "}
              <a href={`#/agents/${task.claimedBy.id}`} className="text-sky-300 hover:underline">
                {task.claimedBy.name}
              </a>
              {task.claimedAt && ` · claimed ${timeAgo(task.claimedAt)}`}
            </span>
            {active && worker && <PresenceBadge lastSeenAt={worker.lastSeenAt} />}
          </p>
        )}
      </div>

      {actionError && <ErrorBox message={actionError} />}

      <Card title="Prompt">
        <p className="whitespace-pre-wrap text-sm text-zinc-300">{task.prompt}</p>
      </Card>

      {task.result !== null && (
        <Card title={task.status === "failed" ? "Failure reason" : "Result"}>
          <p className="whitespace-pre-wrap text-sm text-zinc-300">{task.result}</p>
        </Card>
      )}

      <Card title="Conversation">
        {task.messages.length === 0 ? (
          <p className="text-sm text-zinc-500">No messages yet.</p>
        ) : (
          <div className="space-y-3">
            {task.messages.map((m) => (
              <div
                key={m.id}
                className={`rounded-md border p-3 ${m.isQuestion ? "border-amber-500/40" : "border-zinc-800"}`}
              >
                <p className="flex items-center gap-2 text-xs text-zinc-500">
                  <span className="text-zinc-300">{m.authorType === "supervisor" ? "Supervisor" : m.author?.name}</span>
                  {timeAgo(m.createdAt)}
                  {m.isQuestion && <Tag tone="amber">question</Tag>}
                </p>
                <p className="mt-1 whitespace-pre-wrap text-sm text-zinc-200">{m.body}</p>
              </div>
            ))}
          </div>
        )}
        {task.status === "needs_input" && (
          <p className="mt-3 text-xs text-amber-300">
            The worker is waiting for an answer. Replying hands the task back to it.
          </p>
        )}
        <div className="mt-3 flex gap-2">
          <textarea
            value={reply}
            onChange={(e) => setReply(e.target.value)}
            placeholder={task.status === "needs_input" ? "Type an answer…" : "Write a message…"}
            rows={2}
            className={inputClass}
          />
          <button
            type="button"
            disabled={busy || reply.trim().length === 0}
            onClick={() =>
              run(async () => {
                await api.postMessage(task.id, reply);
                setReply("");
              })
            }
            className={`${buttonPrimary} self-end`}
          >
            {task.status === "needs_input" ? "Answer" : "Send"}
          </button>
        </div>
      </Card>

      <Card title="Intervene">
        <div className="flex flex-wrap items-end gap-3">
          <div className="w-56">
            <Field label="Assign to">
              <select value={assignValue} onChange={(e) => setAssignTo(e.target.value)} className={inputClass}>
                <option value="">Any agent</option>
                {agents.map((a) => (
                  <option key={a.id} value={a.name}>
                    {a.name}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          <button
            type="button"
            disabled={busy}
            onClick={() =>
              run(async () => {
                await api.requeueTask(task.id, assignValue || null);
                setAssignTo(null);
              })
            }
            className={buttonSecondary}
          >
            {requeueLabel}
          </button>
          {(active || task.status === "pending") && (
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                if (window.confirm("Cancel this task?")) void run(() => api.cancelTask(task.id));
              }}
              className={buttonDanger}
            >
              Cancel task
            </button>
          )}
        </div>
        <p className="mt-2 text-xs text-zinc-500">{requeueHint}</p>
      </Card>

      <Card title="Timeline">
        <EventList events={events} />
      </Card>
    </div>
  );
}
