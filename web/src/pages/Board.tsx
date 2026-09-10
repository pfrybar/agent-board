import { useEffect, useState } from "react";
import { api, type TaskStatus } from "../api.ts";
import { presenceOf } from "../format.ts";
import {
  buttonSecondary,
  Empty,
  ErrorBox,
  PRESENCE_DOT,
  Spinner,
  STATUS_LABELS,
  TaskRow,
} from "../ui.tsx";
import { useLoad } from "../useLoad.ts";

const FILTERS: Array<TaskStatus | "all"> = [
  "all",
  "pending",
  "claimed",
  "needs_input",
  "completed",
  "failed",
  "cancelled",
];

const PAGE_SIZE = 50;

export default function Board() {
  const [filter, setFilter] = useState<TaskStatus | "all">("all");
  // 0 is the page with the newest tasks.
  const [page, setPage] = useState(0);
  const { data, error, loading, reload } = useLoad(
    async () => {
      const [tasks, overview, agents] = await Promise.all([
        api.tasks({
          status: filter === "all" ? undefined : filter,
          limit: PAGE_SIZE,
          offset: page * PAGE_SIZE,
        }),
        api.overview(),
        api.agents(),
      ]);
      return { tasks: tasks.tasks, total: tasks.total, counts: overview.tasks, agents: agents.agents };
    },
    [filter, page],
    5000,
  );

  const pageCount = Math.max(1, Math.ceil((data?.total ?? 0) / PAGE_SIZE));
  // Tasks can leave the filter while a later page is open. If the list
  // shrinks past this page, move to the new last page.
  useEffect(() => {
    if (page > pageCount - 1) setPage(pageCount - 1);
  }, [page, pageCount]);

  function goToPage(next: number) {
    setPage(next);
    window.scrollTo({ top: 0 });
  }

  const lastSeen = new Map(data?.agents.map((a) => [a.id, a.lastSeenAt]));
  const presence = { active: 0, idle: 0, offline: 0 };
  for (const a of data?.agents ?? []) presence[presenceOf(a.lastSeenAt)] += 1;

  return (
    <div className="space-y-4">
      {data && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
          {(
            [
              ["Pending", data.counts.pending, "text-sky-300"],
              ["Claimed", data.counts.claimed, "text-violet-300"],
              ["Needs input", data.counts.needs_input, "text-amber-300"],
              ["Failed", data.counts.failed, "text-red-300"],
              ["Total", data.counts.total, "text-zinc-300"],
            ] as const
          ).map(([label, value, color]) => (
            <div key={label} className="rounded-lg border border-zinc-800 bg-zinc-900/60 px-4 py-3">
              <div className={`text-2xl font-bold ${color}`}>{value}</div>
              <div className="text-xs text-zinc-500">{label}</div>
            </div>
          ))}
        </div>
      )}
      {data && (
        <p className="text-xs text-zinc-500">
          {(["active", "idle", "offline"] as const).map((p, i) => (
            <span key={p}>
              {i > 0 && <span className="mx-1.5 text-zinc-700">·</span>}
              <span className={`mr-1 inline-block h-2 w-2 rounded-full ${PRESENCE_DOT[p]}`} />
              {presence[p]} {p}
            </span>
          ))}
          <a href="#/agents" className="ml-2 text-zinc-400 hover:text-zinc-200">
            view agents →
          </a>
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        {FILTERS.map((f) => (
          <button
            key={f}
            type="button"
            onClick={() => {
              setFilter(f);
              setPage(0);
            }}
            className={`rounded-full px-3 py-1 text-xs font-medium ring-1 ring-inset ${
              filter === f
                ? "bg-zinc-100 text-zinc-900 ring-zinc-100"
                : "bg-zinc-900 text-zinc-300 ring-zinc-700 hover:bg-zinc-800"
            }`}
          >
            {f === "all" ? "All" : STATUS_LABELS[f]}
          </button>
        ))}
      </div>

      {loading ? (
        <Spinner />
      ) : !data ? (
        <ErrorBox message={error ?? "Failed to load tasks"} onRetry={reload} />
      ) : data.tasks.length === 0 ? (
        <Empty>No tasks here yet.</Empty>
      ) : (
        <div className="space-y-3">
          <div className="space-y-2">
            {data.tasks.map((t) => (
              <TaskRow
                key={t.id}
                task={t}
                workerLastSeen={t.claimedBy ? (lastSeen.get(t.claimedBy.id) ?? null) : undefined}
              />
            ))}
          </div>
          <Pager page={page} pageCount={pageCount} total={data.total} onPage={goToPage} />
        </div>
      )}
    </div>
  );
}

function Pager({
  page,
  pageCount,
  total,
  onPage,
}: {
  page: number;
  pageCount: number;
  total: number;
  onPage: (page: number) => void;
}) {
  const first = page * PAGE_SIZE + 1;
  const last = Math.min(total, (page + 1) * PAGE_SIZE);
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-zinc-500">
      <span>
        Showing {first}–{last} of {total}
      </span>
      {pageCount > 1 && (
        <div className="flex items-center gap-2">
          <button type="button" disabled={page === 0} onClick={() => onPage(0)} className={buttonSecondary}>
            Newest
          </button>
          <button type="button" disabled={page === 0} onClick={() => onPage(page - 1)} className={buttonSecondary}>
            ← Newer
          </button>
          <span className="px-1">
            Page {page + 1} of {pageCount}
          </span>
          <button
            type="button"
            disabled={page >= pageCount - 1}
            onClick={() => onPage(page + 1)}
            className={buttonSecondary}
          >
            Older →
          </button>
        </div>
      )}
    </div>
  );
}
