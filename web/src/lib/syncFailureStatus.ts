export type SyncFailure = 'conflict' | 'rejected' | 'session-expired' | 'retry';

const TERMINAL_STATUSES = [400, 403, 404, 413, 422];

/** Maps an HTTP status from /api/sync to the outbox's recovery policy. */
export function classifySyncStatus(status: number): SyncFailure {
  if (status === 409) return 'conflict';
  if (TERMINAL_STATUSES.includes(status)) return 'rejected';
  if (status === 401) return 'session-expired';
  return 'retry';
}

/** Parses a Retry-After header (seconds or HTTP-date), falling back cleanly. */
export function parseRetryAfterMs(raw: string | null, fallbackMs = 5000): number {
  if (raw === null) return fallbackMs;
  if (/^\d+$/.test(raw.trim())) return Math.max(0, Number(raw.trim()) * 1000);
  const parsedDate = Date.parse(raw);
  return Number.isFinite(parsedDate) ? Math.max(0, parsedDate - Date.now()) : fallbackMs;
}
