import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppState, LocalData, Mutation } from '../types';
import { dispatchKeepaliveBatch } from './outboxBackground';
import { applyNativeSyncOutcomes } from './outboxBackgroundResolve';

const baseState: AppState = {
  id: 'alice',
  displayName: 'Alice',
  revision: 4,
  profileRevision: 1,
  profile: null,
  start: '2026-01-01',
  end: '2026-03-01',
  entries: [],
  foods: [],
  weights: [],
  days: [],
  plans: []
};

const op = (id: string, recordId = 'e1'): Mutation => ({
  id,
  kind: 'entry',
  recordId,
  expectedRevision: 0,
  delete: false,
  data: { date: '2026-02-01', name: 'Chicken rice', calories: 600 }
});

describe('background outbox helpers', () => {
  beforeEach(() => vi.restoreAllMocks());
  afterEach(() => vi.unstubAllGlobals());

  it('applies native WorkManager outcomes cleanly across ack, conflict, and rejection', () => {
    const m1 = op('m1', 'r1');
    const m2 = op('m2', 'r2');
    const m3 = op('m3', 'r3');
    const local: LocalData = { state: baseState, queue: [m1, m2, m3], conflicts: [] };
    const result = applyNativeSyncOutcomes(local, [
      { id: 'm1', outcome: 'acked', revision: 9 },
      { id: 'm2', outcome: 'conflict', message: 'Conflict' },
      { id: 'm3', outcome: 'rejected', message: 'Invalid' },
      { id: 'missing', outcome: 'acked', revision: 10 }
    ]);

    expect(result.changed).toBe(true);
    expect(result.acked).toHaveLength(1);
    expect(result.next.queue).toEqual([]);
    expect(result.next.state.revision).toBe(9);
    expect(result.next.state.entries.map(e => e.id)).toEqual(['r1']);
    expect(result.next.conflicts?.map(c => c.id)).toEqual(['m2']);
  });

  it('dispatches keepalive POST /api/sync synchronously without duplicating in-flight ops', async () => {
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(new Response(JSON.stringify({ revision: 7 }), { status: 200 })));
    vi.stubGlobal('fetch', fetchMock);
    let data: LocalData = { state: baseState, queue: [op('m1', 'r1'), op('m2', 'r2')] };
    const inFlight = new Map<string, Promise<void>>();
    const onAck = vi.fn().mockResolvedValue(undefined);
    const onSettled = vi.fn();

    dispatchKeepaliveBatch({
      user: 'alice',
      queue: data.queue,
      inFlight,
      isAlive: () => true,
      commit: async change => { data = change(data); },
      onErrorClear: vi.fn(),
      onRejectedNotice: vi.fn(),
      onSessionExpired: vi.fn(),
      onSettled
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0][0]).toBe('/api/sync');
    expect(fetchMock.mock.calls[0][1]).toMatchObject({
      method: 'POST',
      keepalive: true,
      credentials: 'same-origin',
      headers: expect.objectContaining({ 'X-Nutrition-Request': '1', 'X-Nutrition-Account': 'alice' })
    });

    // Calling again immediately while m1/m2 are inFlight must not double-send.
    dispatchKeepaliveBatch({
      user: 'alice',
      queue: data.queue,
      inFlight,
      isAlive: () => true,
      commit: async change => { data = change(data); },
      onErrorClear: vi.fn(),
      onRejectedNotice: vi.fn(),
      onSessionExpired: vi.fn(),
      onSettled
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);

    await Promise.all([...inFlight.values()]);
    expect(data.queue).toEqual([]);
    expect(onSettled).toHaveBeenCalledTimes(2);
  });

  it('handles 401 session expiry without dropping queued mutations', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('{}', { status: 401 }));
    vi.stubGlobal('fetch', fetchMock);
    let data: LocalData = { state: baseState, queue: [op('m1', 'r1')] };
    const inFlight = new Map<string, Promise<void>>();
    const onSessionExpired = vi.fn();

    dispatchKeepaliveBatch({
      user: 'alice',
      queue: data.queue,
      inFlight,
      isAlive: () => true,
      commit: async change => { data = change(data); },
      onErrorClear: vi.fn(),
      onRejectedNotice: vi.fn(),
      onSessionExpired,
      onSettled: vi.fn()
    });

    await Promise.all([...inFlight.values()]);
    expect(onSessionExpired).toHaveBeenCalledOnce();
    expect(data.queue).toHaveLength(1);
  });
});
