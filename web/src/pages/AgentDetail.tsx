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
  inputClass,
  KeyReveal,
  PresenceBadge,
  Spinner,
  Tag,
  TaskRow,
} from "../ui.tsx";
import { useLoad } from "../useLoad.ts";

export default function AgentDetail({ id }: { id: string }) {
  const { data, error, loading, reload } = useLoad(() => api.agent(id), [id], 10_000);
  // null = the field shows the saved description.
  const [description, setDescription] = useState<string | null>(null);
  const [newKey, setNewKey] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  async function run(action: () => Promise<unknown>): Promise<boolean> {
    setBusy(true);
    setActionError(null);
    try {
      await action();
      await reload();
      return true;
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Action failed");
      return false;
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <Spinner />;
  if (!data) return <ErrorBox message={error ?? "Agent not found"} onRetry={reload} />;

  const { agent, tasks, events } = data;
  const descriptionValue = description ?? agent.description ?? "";

  function replaceKey() {
    if (agent.hasKey && !window.confirm("Replace the key? The current key stops working immediately.")) return;
    void run(async () => setNewKey((await api.issueKey(id)).key));
  }

  function revoke() {
    if (!window.confirm(`Revoke ${agent.name}'s key? It stops working immediately.`)) return;
    void run(() => api.revokeKey(id));
  }

  async function remove() {
    if (!window.confirm(`Delete ${agent.name}? Its finished tasks stay on the board.`)) return;
    if (await run(() => api.deleteAgent(id))) window.location.hash = "#/agents";
  }

  return (
    <div className="space-y-4">
      <div>
        <a href="#/agents" className="text-xs text-zinc-500 hover:text-zinc-300">
          ← Back to agents
        </a>
        <div className="mt-1 flex flex-wrap items-center gap-2">
          <h1 className="text-xl font-bold text-zinc-100">{agent.name}</h1>
          {agent.canSend && <Tag tone="sky">can send</Tag>}
        </div>
        <div className="mt-2">
          <PresenceBadge lastSeenAt={agent.lastSeenAt} />
        </div>
        <p className="mt-1 text-xs text-zinc-500">
          {agent.id} · registered {timeAgo(agent.createdAt)}
          {agent.activeTasks > 0 && ` · working on ${agent.activeTasks} task${agent.activeTasks === 1 ? "" : "s"}`}
        </p>
      </div>

      {actionError && <ErrorBox message={actionError} />}
      {newKey && <KeyReveal agentName={agent.name} apiKey={newKey} onDone={() => setNewKey(null)} />}

      <Card title="Settings">
        <div className="space-y-3">
          <div className="flex gap-2">
            <input
              value={descriptionValue}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What this agent does"
              className={inputClass}
            />
            <button
              type="button"
              disabled={busy || description === null}
              onClick={() =>
                run(async () => {
                  await api.updateAgent(id, { description: descriptionValue.trim() || null });
                  setDescription(null);
                })
              }
              className={buttonSecondary}
            >
              Save
            </button>
          </div>
          <label className="flex items-center gap-2 text-sm text-zinc-300">
            <input
              type="checkbox"
              checked={agent.canSend}
              disabled={busy}
              onChange={(e) => void run(() => api.updateAgent(id, { canSend: e.target.checked }))}
              className="accent-sky-500"
            />
            Can send tasks (let this agent submit work for other agents)
          </label>
        </div>
      </Card>

      <Card title="API key">
        {agent.hasKey ? (
          <p className="text-sm text-zinc-300">
            <span className="font-mono">{agent.keyPrefix}…</span>
            <span className="ml-2 text-xs text-zinc-500">issued {timeAgo(agent.keyCreatedAt)}</span>
          </p>
        ) : (
          <p className="text-sm text-red-300">No key: this agent can't connect until you issue one.</p>
        )}
        <div className="mt-3 flex gap-2">
          <button type="button" disabled={busy} onClick={replaceKey} className={buttonPrimary}>
            {agent.hasKey ? "Replace key" : "Issue key"}
          </button>
          {agent.hasKey && (
            <button type="button" disabled={busy} onClick={revoke} className={buttonDanger}>
              Revoke key
            </button>
          )}
        </div>
      </Card>

      <Card title="Tasks">
        {tasks.length === 0 ? (
          <p className="text-sm text-zinc-500">No tasks yet.</p>
        ) : (
          <div className="space-y-2">
            {tasks.map((t) => (
              <TaskRow
                key={t.id}
                task={t}
                workerLastSeen={t.claimedBy?.id === agent.id ? agent.lastSeenAt : undefined}
              />
            ))}
          </div>
        )}
      </Card>

      <Card title="Recent activity">
        <EventList events={events} showTask />
      </Card>

      <div>
        <button type="button" disabled={busy} onClick={remove} className={buttonDanger}>
          Delete agent
        </button>
      </div>
    </div>
  );
}
