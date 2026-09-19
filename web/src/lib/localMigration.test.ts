import { describe, it, expect, vi } from 'vitest';
import { migrateV1ToV2, stripLegacyScanDrafts } from './local';
import type { LocalData, AppState } from '../types';

function createMockIdb(initialData: Record<string, Map<string, any>> = {}) {
  const stores = new Map<string, Map<string, any>>();
  for (const [name, map] of Object.entries(initialData)) {
    stores.set(name, new Map(map));
  }
  const ensureStore = (name: string) => {
    if (!stores.has(name)) stores.set(name, new Map());
    return stores.get(name)!;
  };

  const db = {
    objectStoreNames: {
      contains: (name: string) => stores.has(name)
    },
    transaction: (storeName: string, mode: 'readonly' | 'readwrite') => {
      const store = ensureStore(storeName);
      return {
        objectStore: () => ({
          get: (key: string) => {
            const req: any = { result: store.get(key) };
            setTimeout(() => req.onsuccess?.(), 0);
            return req;
          },
          put: (val: any, key?: string) => {
            const effectiveKey = key ?? val.id;
            store.set(effectiveKey, val);
            const req: any = {};
            setTimeout(() => req.onsuccess?.(), 0);
            return req;
          },
          delete: (key: string) => {
            store.delete(key);
            const req: any = {};
            setTimeout(() => req.onsuccess?.(), 0);
            return req;
          },
          getAllKeys: () => {
            const req: any = { result: [...store.keys()] };
            setTimeout(() => req.onsuccess?.(), 0);
            return req;
          }
        }),
        oncomplete: null as any,
        onerror: null as any,
        onabort: null as any,
        commit: function () {
          setTimeout(() => this.oncomplete?.(), 0);
        }
      };
    },
    _stores: stores
  } as unknown as IDBDatabase;

  // Auto-complete transactions
  const origTx = db.transaction.bind(db);
  (db as any).transaction = (storeName: string, mode: any) => {
    const tx = origTx(storeName, mode);
    setTimeout(() => (tx as any).oncomplete?.(), 5);
    return tx;
  };

  return db;
}

describe('local storage migration and recovery', () => {
  it('migrates v1 LocalData into partitioned stores and separates queue/drafts', async () => {
    const user = 'test-user-v1';
    const mockState: AppState = {
      id: user,
      displayName: 'Test User',
      revision: 10,
      profileRevision: 5,
      profile: null,
      start: '2026-06-20',
      end: '2026-09-18',
      entries: [
        { id: 'e1', date: '2026-09-18', time: '12:00', name: 'Eggs', calories: 140, quantity: 2, unit: 'serving', protein: 12, carbs: 1, fat: 10, fiber: 0, source: 'm', revision: 2, deleted: false }
      ],
      foods: [
        { id: 'f1', name: 'Oatmeal', calories: 150, servingGrams: 40, favourite: true, ingredientsJson: '[]', portionsJson: '[]', cookedYieldGrams: null, revision: 1, deleted: false, protein: 5, carbs: 27, fat: 3, fiber: 4, source: 'm' }
      ],
      weights: [],
      days: [
        { id: 'd1', date: '2026-09-18', status: 'complete', revision: 2, deleted: false }
      ],
      plans: []
    };

    const mockHistoryState: AppState = {
      ...mockState,
      start: '2026-05-01',
      end: '2026-06-19',
      entries: [
        { id: 'e0', date: '2026-05-15', time: '08:00', name: 'Coffee', calories: 5, quantity: 1, unit: 'serving', protein: 0, carbs: 0, fat: 0, fiber: 0, source: 'm', revision: 1, deleted: false }
      ],
      days: []
    };

    const v1Data: LocalData = {
      state: mockState,
      queue: [
        { id: 'q1', kind: 'entry', recordId: 'e2', expectedRevision: 0, data: { name: 'Toast' }, delete: false }
      ],
      photoDrafts: [{ id: 'p1', date: '2026-09-18', photos: [] }],
      bodyDrafts: [{ id: 'b1', date: '2026-09-18', measurements: {}, photos: [], mutationId: 'm1', expectedRevision: 0 }],
      history: {
        '2026-05-15': mockHistoryState
      }
    };

    const accountsStore = new Map<string, any>();
    accountsStore.set(user, v1Data);

    const db = createMockIdb({ accounts: accountsStore });

    const success = await migrateV1ToV2(db, user);
    expect(success).toBe(true);

    const stores = (db as any)._stores as Map<string, Map<string, any>>;

    // Check mutations store
    const mutationsStore = stores.get('mutations');
    expect(mutationsStore?.get(user)).toEqual({ queue: v1Data.queue });

    // Check drafts store
    const draftsStore = stores.get('drafts');
    expect(draftsStore?.get(user)).toEqual({
      photoDrafts: v1Data.photoDrafts,
      bodyDrafts: v1Data.bodyDrafts
    });

    // Check saved_foods store
    const foodsStore = stores.get('saved_foods');
    expect(foodsStore?.get(user)?.foods).toHaveLength(1);
    expect(foodsStore?.get(user)?.foods[0].name).toBe('Oatmeal');

    // Check diary_days store
    const diaryDaysStore = stores.get('diary_days');
    expect(diaryDaysStore?.has(`${user}:2026-09-18`)).toBe(true);
    expect(diaryDaysStore?.has(`${user}:2026-05-15`)).toBe(true);
    expect(diaryDaysStore?.get(`${user}:2026-09-18`).entries[0].name).toBe('Eggs');
    expect(diaryDaysStore?.get(`${user}:2026-05-15`).entries[0].name).toBe('Coffee');

    // Check migration completion marker
    const metaStore = stores.get('meta');
    expect(metaStore?.get(`migrated_v2:${user}`)).toBe(true);
  });

  it('handles QuotaExceededError gracefully without data loss', async () => {
    const user = 'quota-user';
    const accountsStore = new Map<string, any>();
    accountsStore.set(user, {
      state: { id: user, revision: 1, entries: [], days: [], foods: [], weights: [], plans: [] },
      queue: [{ id: 'q1', kind: 'entry', recordId: 'r1', expectedRevision: 0, data: {}, delete: false }]
    });

    const db = createMockIdb({ accounts: accountsStore });
    // Simulate quota error on put
    const origPut = db.transaction;
    let failOnMutations = true;
    (db as any).transaction = (storeName: string, mode: any) => {
      if (storeName === 'mutations' && failOnMutations) {
        const error = new DOMException('Storage quota exceeded', 'QuotaExceededError');
        throw error;
      }
      return origPut(storeName, mode);
    };

    const success = await migrateV1ToV2(db, user);
    expect(success).toBe(false);

    // Marker was NOT set so migration can be retried later
    const stores = (db as any)._stores as Map<string, Map<string, any>>;
    const metaStore = stores.get('meta');
    expect(metaStore?.get(`migrated_v2:${user}`)).toBeUndefined();
  });

  it('strips legacy scan drafts cleanly', () => {
    const raw: any = {
      state: { id: 'u1' },
      queue: [],
      scans: [{ id: 'scan-1' }]
    };
    const cleaned = stripLegacyScanDrafts(raw);
    expect((cleaned as any).scans).toBeUndefined();
  });
});
