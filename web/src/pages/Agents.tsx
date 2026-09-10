import { useState, type FormEvent } from "react";
import { api } from "../api.ts";
import { presenceOf, timeAgo, type Presence } from "../format.ts";
import {
  buttonPrimary,
  Card,
  Empty,
  ErrorBox,
  Field,
  inputClass,
  KeyReveal,
  PresenceBadge,
  Spinner,
  Tag,
} from "../ui.tsx";
import { useLoad } from "../useLoad.ts";

const FILTERS: Array<{ key: "all" | Presence; label: string }> = [
  { key: "all", label: "All" },
  { key: "active", label: "Active" },
  { key: "idle", label: "Idle" },
  { key: "offline", label: "Offline" },
];

export default function Agents() {
  const { data, error, loading, reload } = useLoad(() => api.agents(), [], 10_000);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [canSend, setCanSend] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [issued, setIssued] = useState<{ name: string; key: string } | null>(null);
  const [filter, setFilter] = useState<"all" | Presence>("all");

  async function create(e: FormEvent) {
    e.preventDefault();
    setCreating(true);
    setCreateError(null);
    try {
      const res = await api.createAgent({
        name: name.trim(),
        description: description.trim() || undefined,
        canSend,
      });
      setIssued({ name: res.agent.name, key: res.key });
      setName("");
      setDescription("");
      setCanSend(false);
      await reload();
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : "Failed to create agent");
    } finally {
      setCreating(false);
    }
  }

  const agents = data?.agents ?? [];

  return (
    <div className="space-y-6">
      {issued && <KeyReveal agentName={issued.name} apiKey={issued.key} onDone={() => setIssued(null)} />}

      <Card title="Register an agent">
        <form onSubmit={create} className="grid gap-3 sm:grid-cols-2">
          <Field label="Name">
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="researcher-1" className={inputClass} />
          </Field>
          <Field label="Description">
            <input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What this agent does"
              className={inputClass}
            />
          </Field>
          <label className="flex items-center gap-2 text-sm text-zinc-300 sm:col-span-2">
            <input
              type="checkbox"
              checked={canSend}
              onChange={(e) => setCanSend(e.target.checked)}
              className="accent-sky-500"
            />
            Can send tasks (let this agent submit work for other agents)
          </label>
          <div className="sm:col-span-2">
            <button type="submit" disabled={creating || name.trim().length === 0} className={buttonPrimary}>
              {creating ? "Creating…" : "Create agent and key"}
            </button>
            {createError && <p className="mt-2 text-sm text-red-300">{createError}</p>}
          </div>
        </form>
      </Card>

      {loading ? (
        <Spinner />
      ) : !data ? (
        <ErrorBox message={error ?? "Failed to load agents"} onRetry={reload} />
      ) : agents.length === 0 ? (
        <Empty>No agents registered yet.</Empty>
      ) : (
        <div>
          <div className="mb-3 flex gap-2">
            {FILTERS.map((f) => {
              const count =
                f.key === "all" ? agents.length : agents.filter((a) => presenceOf(a.lastSeenAt) === f.key).length;
              return (
                <button
                  key={f.key}
                  type="button"
                  onClick={() => setFilter(f.key)}
                  className={`rounded-full px-3 py-1 text-xs ${
                    filter === f.key
                      ? "bg-zinc-200 font-medium text-zinc-900"
                      : "bg-zinc-800 text-zinc-400 hover:bg-zinc-700"
                  }`}
                >
                  {f.label} · {count}
                </button>
              );
            })}
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            {agents
              .filter((a) => filter === "all" || presenceOf(a.lastSeenAt) === filter)
              .map((a) => (
                <a
                  key={a.id}
                  href={`#/agents/${a.id}`}
                  className="block rounded-lg border border-zinc-800 bg-zinc-900/60 p-4 hover:border-zinc-600"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium text-zinc-100">{a.name}</span>
                    <span className="flex gap-1">
                      {a.canSend && <Tag tone="sky">can send</Tag>}
                      {!a.hasKey && <Tag tone="red">no key</Tag>}
                    </span>
                  </div>
                  <div className="mt-1.5">
                    <PresenceBadge lastSeenAt={a.lastSeenAt} />
                  </div>
                  {a.description && <p className="mt-1 text-sm text-zinc-400">{a.description}</p>}
                  <p className="mt-2 text-xs text-zinc-600">
                    {a.activeTasks > 0 && `working on ${a.activeTasks} task${a.activeTasks === 1 ? "" : "s"} · `}
                    registered {timeAgo(a.createdAt)}
                  </p>
                </a>
              ))}
          </div>
        </div>
      )}
    </div>
  );
}
