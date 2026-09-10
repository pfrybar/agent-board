import { randomBytes } from "node:crypto";

/** An error the API reports as `{ error, code }` with an HTTP status. */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

export function now(): number {
  return Date.now();
}

/** Storage timestamp (Unix ms) to wire format (ISO-8601). */
export function iso(ms: number): string;
export function iso(ms: number | null): string | null;
export function iso(ms: number | null): string | null {
  return ms === null ? null : new Date(ms).toISOString();
}

/** Short random ids like `t_3f9a1c2b4d5e`: easy for an agent to copy. */
export function newId(prefix: string): string {
  return `${prefix}_${randomBytes(6).toString("hex")}`;
}

/** A required string field, not blank, at most `max` characters. */
export function text(value: unknown, field: string, max: number): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new ApiError(400, "validation", `${field} is required`);
  }
  if (value.length > max) {
    throw new ApiError(400, "validation", `${field} must be at most ${max} characters`);
  }
  return value;
}

/** An optional string field: missing or blank becomes null; otherwise trimmed. */
export function optionalText(value: unknown, field: string, max: number): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value === "string" && value.trim() === "") return null;
  return text(value, field, max).trim();
}

/** A request body as a plain object (anything else becomes `{}`). */
export function bodyOf(body: unknown): Record<string, unknown> {
  return body !== null && typeof body === "object" && !Array.isArray(body)
    ? (body as Record<string, unknown>)
    : {};
}

/** Parse a `limit` query parameter. */
export function limitParam(raw: unknown, fallback: number): number {
  if (raw === undefined || raw === "") return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1) {
    throw new ApiError(400, "validation", "limit must be a positive integer");
  }
  return Math.min(n, 500);
}

/** Parse an `offset` query parameter. */
export function offsetParam(raw: unknown): number {
  if (raw === undefined || raw === "") return 0;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0) {
    throw new ApiError(400, "validation", "offset must be a non-negative integer");
  }
  return n;
}
