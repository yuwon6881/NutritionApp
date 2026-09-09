export const PACING_MS = 4200;
export const BACKOFF_MS = 5000;
export const MAX_ATTEMPTS = 3;

export type ScanStatus =
  | 'queued'
  | 'looking-up'
  | 'added'
  | 'not-found'
  | 'no-calories'
  | 'rate-limited'
  | 'failed';

export interface QueueItem {
  code: string;
  status: ScanStatus;
  attempts: number;
  message?: string;
  name?: string;
}

export interface ScanQueueState {
  items: QueueItem[];
  nextAt: number;
}

export type ScanOutcome =
  | {status: 'added'; name?: string}
  | {status: 'not-found'; message?: string}
  | {status: 'no-calories'; message?: string}
  | {status: 'rate-limited'; message?: string}
  | {status: 'failed'; message?: string};

export function initialQueueState(): ScanQueueState {
  return {items: [], nextAt: 0};
}

export function enqueue(state: ScanQueueState, code: string): ScanQueueState {
  const trimmed = code.trim();
  if (!trimmed) return state;
  const existing = state.items.find(i => i.code === trimmed);
  if (existing) {
    if (existing.status !== 'not-found' && existing.status !== 'failed') {
      return state;
    }
    return {
      ...state,
      items: state.items.map(i =>
        i.code === trimmed ? {code: trimmed, status: 'queued', attempts: 0} : i
      ),
    };
  }
  return {
    ...state,
    items: [...state.items, {code: trimmed, status: 'queued', attempts: 0}],
  };
}

export function nextCode(state: ScanQueueState, now: number): string | undefined {
  if (state.items.some(i => i.status === 'looking-up')) return undefined;
  if (now < state.nextAt) return undefined;
  const item = state.items.find(i => i.status === 'queued' || i.status === 'rate-limited');
  return item?.code;
}

export function begin(
  state: ScanQueueState,
  code: string,
  now: number,
  pacingMs = PACING_MS
): ScanQueueState {
  return {
    ...state,
    nextAt: now + pacingMs,
    items: state.items.map(i =>
      i.code === code
        ? {
            ...i,
            status: 'looking-up',
            attempts: i.attempts + 1,
            message: undefined,
          }
        : i
    ),
  };
}

export function settle(
  state: ScanQueueState,
  code: string,
  outcome: ScanOutcome,
  now: number,
  backoffMs = BACKOFF_MS,
  maxAttempts = MAX_ATTEMPTS
): ScanQueueState {
  const item = state.items.find(i => i.code === code);
  if (!item) return state;

  if (outcome.status === 'rate-limited') {
    if (item.attempts < maxAttempts) {
      return {
        ...state,
        nextAt: Math.max(state.nextAt, now + backoffMs),
        items: state.items.map(i =>
          i.code === code
            ? {
                ...i,
                status: 'rate-limited',
                message: outcome.message ?? 'Rate limited. Retrying…',
              }
            : i
        ),
      };
    }
    return {
      ...state,
      items: state.items.map(i =>
        i.code === code
          ? {
              ...i,
              status: 'failed',
              message: 'Rate limit exceeded.',
            }
          : i
      ),
    };
  }

  return {
    ...state,
    items: state.items.map(i =>
      i.code === code
        ? {
            ...i,
            status: outcome.status,
            name: outcome.status === 'added' ? outcome.name : undefined,
            message:
              outcome.status === 'not-found'
                ? outcome.message ?? 'Barcode not found.'
                : outcome.status === 'no-calories'
                ? outcome.message ?? 'No calorie data reported.'
                : outcome.status === 'failed'
                ? outcome.message ?? 'Lookup failed.'
                : undefined,
          }
        : i
    ),
  };
}

export function waitMs(state: ScanQueueState, now: number): number {
  return Math.max(0, state.nextAt - now);
}

export function outstanding(state: ScanQueueState): number {
  return state.items.filter(
    i => i.status === 'queued' || i.status === 'looking-up' || i.status === 'rate-limited'
  ).length;
}

export function etaSeconds(outstandingCount: number, currentWaitMs = 0, pacingMs = PACING_MS): number {
  if (outstandingCount <= 0) return 0;
  const totalMs = currentWaitMs + (outstandingCount - 1) * pacingMs;
  return Math.round(totalMs / 1000);
}
