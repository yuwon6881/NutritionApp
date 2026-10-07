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
  it('preserves authoritative empty partitions when a legacy migration is retried',async()=>{
    const user='retry-user';
    const state:AppState={id:user,displayName:'Retry',revision:1,profileRevision:0,profile:null,start:'2026-01-01',end:'2026-01-02',entries:[],weights:[],days:[],plans:[],foods:[{id:'old',name:'Old food'} as AppState['foods'][number]]};
    const db=createMockIdb({
      accounts:new Map([[user,{state,queue:[{id:'stale'}],photoDrafts:[{id:'stale-photo'}]}]]),
      saved_foods:new Map([[user,{foods:[],revision:2,loaded:true}]]),
      mutations:new Map([[user,{queue:[]}]]),
      drafts:new Map([[user,{photoDrafts:[],bodyDrafts:[]}]])
    });
    await migrateV1ToV2(db,user);
    const {idbGet}=await import('./idb');
    expect(await idbGet(db,'saved_foods',user)).toEqual({foods:[],revision:2,loaded:true});
    expect(await idbGet(db,'mutations',user)).toEqual({queue:[]});
    expect(await idbGet(db,'drafts',user)).toEqual({photoDrafts:[],bodyDrafts:[]});
  });
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

    // The account keeps its current diary; legacy history is dropped and no dated-day copy is written
    const account = stores.get('accounts')?.get(user);
    expect(account.history).toBeUndefined();
    expect(account.state.entries[0].name).toBe('Eggs');
    expect(stores.get('diary_days')?.size ?? 0).toBe(0);

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
