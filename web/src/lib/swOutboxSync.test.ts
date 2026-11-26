import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppState, Mutation } from '../types';
import { drainOutboxInServiceWorker } from './swOutboxSync';

type StoreMap = Record<string, Map<string, unknown>>;

function createFakeIndexedDb(stores: StoreMap) {
  const names = Object.keys(stores);
  return {
    open: (_name: string) => {
      const request: {
        result?: unknown;
        error?: unknown;
        transaction?: unknown;
        onupgradeneeded?: () => void;
        onsuccess?: () => void;
        onerror?: () => void;
      } = {};
      const db = {
        objectStoreNames: { contains: (n: string) => names.includes(n) },
        close: () => undefined,
        transaction: (_storeNames: string | string[], _mode?: string) => {
          let pendingOps = 0;
          let completionScheduled = false;
          const scheduleComplete = () => {
            if (pendingOps > 0 || completionScheduled) return;
            completionScheduled = true;
            setTimeout(() => tx.oncomplete?.(), 0);
          };
          const enqueue = <T>(work: () => T, req: { result?: T; onsuccess?: () => void }) => {
            pendingOps++;
            setTimeout(() => {
              req.result = work();
              req.onsuccess?.();
              pendingOps--;
              scheduleComplete();
            }, 0);
          };
          const tx: {
            oncomplete?: () => void;
            onerror?: () => void;
            onabort?: () => void;
            error: null;
            objectStore: (name: string) => unknown;
          } = {
            error: null,
            objectStore: (name: string) => ({
              getAllKeys: () => {
                const req: { result?: unknown[]; onsuccess?: () => void; onerror?: () => void } = {};
                enqueue(() => [...stores[name].keys()], req);
                return req;
              },
              get: (key: string) => {
                const req: { result?: unknown; onsuccess?: () => void; onerror?: () => void } = {};
                enqueue(() => stores[name].get(key), req);
                return req;
              },
              put: (value: unknown, key: string) => {
                stores[name].set(key, structuredClone(value));
              }
            })
          };
          return tx;
        }
      };
      setTimeout(() => {
        request.result = db;
        request.onsuccess?.();
      }, 0);
      return request;
    }
  };
}

const baseState: AppState = {
  id: 'alice',
  displayName: 'Alice',
  revision: 2,
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

const heldOp = (): Mutation => ({
  id: 'm1',
  kind: 'entry',
  recordId: 'r1',
  expectedRevision: 0,
  delete: false,
  holdUntil: Date.now() + 5000,
  data: { date: '2026-02-01', name: 'Nasi lemak', calories: 550 }
});

describe('service worker background sync', () => {
  let stores: StoreMap;

  beforeEach(() => {
    stores = {
      accounts: new Map([['alice', { state: baseState, foodsLoaded: true }]]),
      mutations: new Map([['alice', { queue: [heldOp()], conflicts: [] }]]),
      meta: new Map()
    };
    vi.stubGlobal('indexedDB', createFakeIndexedDb(stores));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('waives holdUntil and syncs when no visible window is open', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ revision: 6 }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const clients = { matchAll: vi.fn().mockResolvedValue([]) };

    await drainOutboxInServiceWorker(clients, 'https://nutrition.test');

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls[0][0]).toBe('https://nutrition.test/api/sync');
    const body = JSON.parse(String((fetchMock.mock.calls[0][1] as RequestInit).body));
    expect(body).not.toHaveProperty('holdUntil');
    expect((stores.mutations.get('alice') as { queue: Mutation[] }).queue).toEqual([]);
    expect((stores.accounts.get('alice') as { state: AppState }).state.revision).toBe(6);
  });

  it('leaves the queue to a visible tab, including edits ready to send', async () => {
    const { holdUntil: _hold, ...released } = heldOp();
    stores.mutations.set('alice', { queue: [released], conflicts: [] });
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const clients = { matchAll: vi.fn().mockResolvedValue([{ visibilityState: 'visible' }]) };

    await drainOutboxInServiceWorker(clients, 'https://nutrition.test');

    expect(fetchMock).not.toHaveBeenCalled();
    expect((stores.mutations.get('alice') as { queue: Mutation[] }).queue).toHaveLength(1);
  });

  it('yields remaining edits when a window becomes visible mid-drain', async () => {
    const first = heldOp();
    const later = { ...first, id: 'm2', recordId: 'r2' };
    stores.mutations.set('alice', { queue: [first, later], conflicts: [] });
    const windows: Pick<WindowClient, 'visibilityState'>[] = [];
    const fetchMock = vi.fn().mockImplementation(async () => {
      windows.push({ visibilityState: 'visible' });
      return new Response(JSON.stringify({ revision: 6 }), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);

    await drainOutboxInServiceWorker({ matchAll: vi.fn().mockResolvedValue(windows) }, 'https://nutrition.test');

    expect(fetchMock).toHaveBeenCalledOnce();
    expect((stores.mutations.get('alice') as { queue: Mutation[] }).queue).toEqual([later]);
  });

  it('retires an acknowledged edit when the page releases its hold during the request', async () => {
    const original = heldOp();
    const { holdUntil: _hold, ...released } = original;
    const later = { ...released, id: 'm2', recordId: 'r2' };
    stores.mutations.set('alice', { queue: [original], conflicts: [] });
    const fetchMock = vi.fn().mockImplementationOnce(async () => {
      stores.mutations.set('alice', { queue: [released, later], conflicts: [] });
      return new Response(JSON.stringify({ revision: 6 }), { status: 200 });
    }).mockResolvedValueOnce(new Response(JSON.stringify({ revision: 7 }), { status: 200 }))
      .mockImplementation(() => { throw new Error('The background dispatcher tried to send an extra mutation.'); });
    vi.stubGlobal('fetch', fetchMock);

    await drainOutboxInServiceWorker({ matchAll: vi.fn().mockResolvedValue([]) }, 'https://nutrition.test');

    expect(fetchMock.mock.calls.map(([, init]) => JSON.parse(init.body).id)).toEqual(['m1', 'm2']);
    expect((stores.mutations.get('alice') as { queue: Mutation[] }).queue).toEqual([]);
  });

  it('stops on 401 without dropping queued mutations and throws on 503 for retry', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('{}', { status: 401 }));
    vi.stubGlobal('fetch', fetchMock);
    const clients = { matchAll: vi.fn().mockResolvedValue([]) };

    await expect(drainOutboxInServiceWorker(clients, 'https://nutrition.test')).resolves.toBeUndefined();
    expect((stores.mutations.get('alice') as { queue: Mutation[] }).queue).toHaveLength(1);

    fetchMock.mockResolvedValueOnce(new Response('{}', { status: 503, headers: { 'Retry-After': '10' } }));
    await expect(drainOutboxInServiceWorker(clients, 'https://nutrition.test')).rejects.toThrow();
    expect((stores.mutations.get('alice') as { queue: Mutation[] }).queue[0].retryAt).toBeGreaterThan(Date.now());
  });
});
