import { useState, type FormEvent } from "react";
import { api, ApiException } from "../api.ts";
import { buttonPrimary, inputClass } from "../ui.tsx";

export default function Login({ onSignedIn }: { onSignedIn: () => void }) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.login(password);
      onSignedIn();
    } catch (err) {
      const status = err instanceof ApiException ? err.status : 0;
      if (status === 429) setError("Too many attempts. Wait a minute and try again.");
      else if (status === 503) setError("Sign-in is disabled: set SUPERVISOR_PASSWORD on the server.");
      else if (status === 401) setError("Wrong password.");
      else setError(err instanceof Error ? err.message : "Sign-in failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-zinc-950 px-4">
      <form onSubmit={submit} className="w-full max-w-sm rounded-xl border border-zinc-800 bg-zinc-900/60 p-8">
        <h1 className="text-xl font-bold tracking-tight text-zinc-100">Agent Board</h1>
        <p className="mt-1 text-sm text-zinc-400">Supervisor sign-in</p>
        <div className="mt-6">
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Supervisor password"
            autoFocus
            autoComplete="current-password"
            className={inputClass}
          />
        </div>
        {error && <p className="mt-3 text-sm text-red-300">{error}</p>}
        <button type="submit" disabled={busy || password.length === 0} className={`${buttonPrimary} mt-4 w-full`}>
          {busy ? "Signing in…" : "Sign in"}
        </button>
      </form>
    </div>
  );
}
