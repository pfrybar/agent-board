import { useState, type FormEvent } from "react";
import { api } from "../api.ts";
import { buttonPrimary, Card, ErrorBox, Field, inputClass } from "../ui.tsx";
import { useLoad } from "../useLoad.ts";

export default function NewTask() {
  const { data } = useLoad(() => api.agents(), []);
  const [title, setTitle] = useState("");
  const [prompt, setPrompt] = useState("");
  const [assignTo, setAssignTo] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { task } = await api.createTask({
        title: title.trim() || undefined,
        prompt: prompt.trim(),
        assignTo: assignTo || undefined,
      });
      window.location.hash = `#/tasks/${task.id}`;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create task");
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <h1 className="text-xl font-bold text-zinc-100">New task</h1>
      {error && <ErrorBox message={error} />}
      <Card>
        <form onSubmit={submit} className="space-y-4">
          <Field label="Title (optional)">
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Summarize the quarterly numbers"
              className={inputClass}
            />
          </Field>
          <Field label="Prompt">
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="What should the agent do?"
              rows={6}
              className={inputClass}
            />
          </Field>
          <Field label="Assign to">
            <select value={assignTo} onChange={(e) => setAssignTo(e.target.value)} className={inputClass}>
              <option value="">Any agent</option>
              {data?.agents.map((a) => (
                <option key={a.id} value={a.name}>
                  {a.name}
                </option>
              ))}
            </select>
          </Field>
          <button type="submit" disabled={busy || prompt.trim().length === 0} className={buttonPrimary}>
            {busy ? "Creating…" : "Create task"}
          </button>
        </form>
      </Card>
    </div>
  );
}
