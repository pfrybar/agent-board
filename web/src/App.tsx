import { useEffect, useState, type ReactNode } from "react";
import { api, onUnauthorized } from "./api.ts";
import Activity from "./pages/Activity.tsx";
import AgentDetail from "./pages/AgentDetail.tsx";
import Agents from "./pages/Agents.tsx";
import Board from "./pages/Board.tsx";
import Login from "./pages/Login.tsx";
import NewTask from "./pages/NewTask.tsx";
import TaskDetail from "./pages/TaskDetail.tsx";
import { Spinner } from "./ui.tsx";

function useHash(): string {
  const [hash, setHash] = useState(() => window.location.hash || "#/");
  useEffect(() => {
    const onChange = () => setHash(window.location.hash || "#/");
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);
  return hash;
}

const NAV: Array<{ href: string; label: string }> = [
  { href: "#/", label: "Board" },
  { href: "#/new", label: "New task" },
  { href: "#/agents", label: "Agents" },
  { href: "#/activity", label: "Activity" },
];

function Shell() {
  const path = useHash().replace(/^#/, "") || "/";

  let page: ReactNode;
  if (path === "/new") page = <NewTask />;
  else if (path === "/agents") page = <Agents />;
  else if (path === "/activity") page = <Activity />;
  else if (path.startsWith("/tasks/")) page = <TaskDetail id={decodeURIComponent(path.slice(7))} />;
  else if (path.startsWith("/agents/")) page = <AgentDetail id={decodeURIComponent(path.slice(8))} />;
  else page = <Board />;

  async function signOut() {
    await api.logout().catch(() => undefined);
    window.location.hash = "#/";
    window.location.reload();
  }

  const active = path === "/" ? "#/" : `#${path.split("/").slice(0, 2).join("/")}`;

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100">
      <header className="border-b border-zinc-800">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
          <a href="#/" className="text-base font-bold tracking-tight">
            Agent Board
          </a>
          <nav className="flex items-center gap-1">
            {NAV.map((n) => (
              <a
                key={n.href}
                href={n.href}
                className={`rounded-md px-3 py-1.5 text-sm ${
                  active === n.href ? "bg-zinc-800 text-zinc-100" : "text-zinc-400 hover:text-zinc-200"
                }`}
              >
                {n.label}
              </a>
            ))}
            <button
              type="button"
              onClick={signOut}
              className="ml-2 rounded-md px-3 py-1.5 text-sm text-zinc-500 hover:text-zinc-200"
            >
              Sign out
            </button>
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-6">{page}</main>
    </div>
  );
}

export default function App() {
  const [state, setState] = useState<"checking" | "in" | "out">("checking");

  useEffect(() => {
    onUnauthorized(() => setState("out"));
    api
      .session()
      .then(() => setState("in"))
      .catch(() => setState("out"));
    return () => onUnauthorized(null);
  }, []);

  if (state === "checking") {
    return (
      <div className="min-h-screen bg-zinc-950">
        <Spinner />
      </div>
    );
  }
  if (state === "out") return <Login onSignedIn={() => setState("in")} />;
  return <Shell />;
}
