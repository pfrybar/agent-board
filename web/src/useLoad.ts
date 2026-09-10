import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Load data for a page: refetch when `deps` change and, optionally, every
 * `refreshMs`. Responses to superseded requests are dropped.
 */
export function useLoad<T>(fetcher: () => Promise<T>, deps: unknown[], refreshMs?: number) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const generation = useRef(0);
  // The caller's deps decide when the fetcher changes.
  const load = useCallback(fetcher, deps);

  const reload = useCallback(async () => {
    const mine = generation.current;
    try {
      const result = await load();
      if (mine !== generation.current) return;
      setData(result);
      setError(null);
    } catch (err) {
      if (mine !== generation.current) return;
      setError(err instanceof Error ? err.message : "Request failed");
    } finally {
      if (mine === generation.current) setLoading(false);
    }
  }, [load]);

  useEffect(() => {
    generation.current += 1;
    setLoading(true);
    void reload();
    if (!refreshMs) return;
    const timer = setInterval(() => void reload(), refreshMs);
    return () => clearInterval(timer);
  }, [reload, refreshMs]);

  return { data, error, loading, reload };
}
