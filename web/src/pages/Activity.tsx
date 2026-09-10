import { useState } from "react";
import { api } from "../api.ts";
import { humanize, timeAgo } from "../format.ts";
import { Empty, ErrorBox, inputClass, Spinner } from "../ui.tsx";
import { useLoad } from "../useLoad.ts";

export default function Activity() {
  const [agentId, setAgentId] = useState("");
  const { data, error, loading, reload } = useLoad(
    async () => {
      const [events, agents] = await Promise.all([api.events(agentId || undefined), api.agents()]);
      return { events: events.events, agents: agents.agents };
    },
    [agentId],
    3000,
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs text-zinc-500">What agents and the supervisor did, newest first. Refreshes every few seconds.</p>
        <div className="w-48">
          <select value={agentId} onChange={(e) => setAgentId(e.target.value)} className={inputClass}>
            <option value="">All agents</option>
            {data?.agents.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      {loading ? (
        <Spinner />
      ) : !data ? (
        <ErrorBox message={error ?? "Failed to load activity"} onRetry={reload} />
      ) : data.events.length === 0 ? (
        <Empty>No activity yet.</Empty>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-zinc-800 bg-zinc-900/60">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-zinc-800 text-zinc-500">
                <th className="px-3 py-2 font-medium">When</th>
                <th className="px-3 py-2 font-medium">Event</th>
                <th className="px-3 py-2 font-medium">Agent</th>
                <th className="px-3 py-2 font-medium">By</th>
                <th className="px-3 py-2 font-medium">Task</th>
                <th className="px-3 py-2 font-medium">Detail</th>
              </tr>
            </thead>
            <tbody>
              {data.events.map((e) => (
                <tr key={e.id} className="border-b border-zinc-800/50 last:border-0 hover:bg-zinc-800/30">
                  <td className="whitespace-nowrap px-3 py-2 text-zinc-500">{timeAgo(e.createdAt)}</td>
                  <td className="whitespace-nowrap px-3 py-2 font-mono text-zinc-300">{humanize(e.type)}</td>
                  <td className="px-3 py-2 text-zinc-300">
                    {e.agent ? (
                      <a href={`#/agents/${e.agent.id}`} className="hover:underline">
                        {e.agent.name}
                      </a>
                    ) : (
                      <span className="text-zinc-600">—</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-zinc-500">{e.actor}</td>
                  <td className="px-3 py-2">
                    {e.taskId ? (
                      <a href={`#/tasks/${e.taskId}`} className="font-mono text-sky-300 hover:underline">
                        {e.taskId}
                      </a>
                    ) : (
                      <span className="text-zinc-600">—</span>
                    )}
                  </td>
                  <td className="max-w-md truncate px-3 py-2 text-zinc-500">{e.detail}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
