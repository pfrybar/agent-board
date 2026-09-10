/** Relative time like "3m ago", or a date for old timestamps. */
export function timeAgo(iso: string | null): string {
  if (!iso) return "—";
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "—";
  const secs = Math.max(0, Math.floor((Date.now() - then) / 1000));
  if (secs < 5) return "just now";
  if (secs < 60) return `${secs}s ago`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(then).toLocaleDateString();
}

export type Presence = "active" | "idle" | "offline";

function ageMs(iso: string): number {
  return Date.now() - new Date(iso).getTime();
}

/** Active: a request in the last 5 minutes. Idle: in the last hour. */
export function presenceOf(lastSeenAt: string | null): Presence {
  if (!lastSeenAt) return "offline";
  const age = ageMs(lastSeenAt);
  if (age < 5 * 60_000) return "active";
  if (age < 60 * 60_000) return "idle";
  return "offline";
}

/** A worker silent this long gets flagged on its claimed tasks. */
export function isQuiet(lastSeenAt: string | null): boolean {
  return !lastSeenAt || ageMs(lastSeenAt) > 30 * 60_000;
}

/** "task_claimed" -> "task claimed". */
export function humanize(type: string): string {
  return type.replaceAll("_", " ");
}
