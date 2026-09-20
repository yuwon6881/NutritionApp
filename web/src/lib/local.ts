import type { AppState, BodyDraft, Day, DatedDiaryDay, Entry, Food, LocalData, Mutation, PhysiqueDraft } from '../types';
import type {SavedFoodsCache} from './savedFoods';

let connection: Promise<IDBDatabase> | undefined;

export function resetDatabaseConnectionForTests() {
  connection = undefined;
}

export function database(): Promise<IDBDatabase> {
  return connection ??= new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('nourish-local', 2);
    request.onupgradeneeded = (event) => {
      const db = request.result;
      const oldVersion = event.oldVersion;
      if (oldVersion < 1) {
        if (!db.objectStoreNames.contains('accounts')) db.createObjectStore('accounts');
      }
      if (oldVersion < 2) {
        if (!db.objectStoreNames.contains('diary_days')) db.createObjectStore('diary_days');
        if (!db.objectStoreNames.contains('saved_foods')) db.createObjectStore('saved_foods');
        if (!db.objectStoreNames.contains('mutations')) db.createObjectStore('mutations');
        if (!db.objectStoreNames.contains('drafts')) db.createObjectStore('drafts');
        if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta');
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function idbGet<T>(db: IDBDatabase, storeName: string, key: IDBValidKey): Promise<T | undefined> {
  return new Promise((resolve, reject) => {
    try {
      const tx = db.transaction(storeName, 'readonly');
      const req = tx.objectStore(storeName).get(key);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    } catch (ex) {
      reject(ex);
    }
  });
}

function idbPut<T>(db: IDBDatabase, storeName: string, value: T, key?: IDBValidKey): Promise<void> {
  return new Promise((resolve, reject) => {
    try {
      const tx = db.transaction(storeName, 'readwrite');
      if (key !== undefined) tx.objectStore(storeName).put(value, key);
      else tx.objectStore(storeName).put(value);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error ?? new Error('Transaction aborted'));
    } catch (ex) {
      reject(ex);
    }
  });
}

function idbDelete(db: IDBDatabase, storeName: string, key: IDBValidKey): Promise<void> {
  return new Promise((resolve, reject) => {
    try {
      const tx = db.transaction(storeName, 'readwrite');
      tx.objectStore(storeName).delete(key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error ?? new Error('Transaction aborted'));
    } catch (ex) {
      reject(ex);
    }
  });
}

function idbGetAllKeys(db: IDBDatabase, storeName: string): Promise<IDBValidKey[]> {
  return new Promise((resolve, reject) => {
    try {
      const tx = db.transaction(storeName, 'readonly');
      const req = tx.objectStore(storeName).getAllKeys();
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    } catch (ex) {
      reject(ex);
    }
  });
}

export async function readDatedDiary(user: string, date: string): Promise<DatedDiaryDay | undefined> {
  const db = await database();
  return idbGet<DatedDiaryDay>(db, 'diary_days', `${user}:${date}`);
}

export async function saveDatedDiary(user: string, date: string, day: DatedDiaryDay): Promise<void> {
  const db = await database();
  return idbPut(db, 'diary_days', day, `${user}:${date}`);
}

export async function saveDatedDiaryBatch(user: string, days: DatedDiaryDay[]): Promise<void> {
  if (!days.length) return;
  const db = await database();
  return new Promise((resolve, reject) => {
    try {
      const tx = db.transaction('diary_days', 'readwrite');
      const store = tx.objectStore('diary_days');
      for (const d of days) {
        store.put(d, `${user}:${d.date}`);
      }
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error ?? new Error('Batch save aborted'));
    } catch (ex) {
      reject(ex);
    }
  });
}

export async function readDatedDiaryRange(user: string, from: string, to: string): Promise<DatedDiaryDay[]> {
  const db = await database();
  const allKeys = await idbGetAllKeys(db, 'diary_days');
  const userPrefix = `${user}:`;
  const matchingKeys = allKeys
    .filter((k): k is string => typeof k === 'string' && k.startsWith(userPrefix))
    .map(k => k.slice(userPrefix.length))
    .filter(date => date >= from && date <= to)
    .sort();

  const results: DatedDiaryDay[] = [];
  for (const date of matchingKeys) {
    const day = await idbGet<DatedDiaryDay>(db, 'diary_days', `${user}:${date}`);
    if (day) results.push(day);
  }
  return results;
}

export async function readSavedFoods(user: string): Promise<SavedFoodsCache | undefined> {
  const db = await database();
  return idbGet(db, 'saved_foods', user);
}

export async function saveSavedFoods(user: string, foods: Food[], revision: number): Promise<void> {
  const db = await database();
  return idbPut(db, 'saved_foods', { foods, revision, fetchedAt: Date.now(), loaded: true }, user);
}

export async function readMutations(user: string): Promise<Mutation[]> {
  const db = await database();
  const record = await idbGet<{ queue: Mutation[] }>(db, 'mutations', user);
  return record?.queue ?? [];
}

export async function saveMutations(user: string, queue: Mutation[]): Promise<void> {
  const db = await database();
  return idbPut(db, 'mutations', { queue }, user);
}

export interface StoredDrafts {
  photoDrafts?: PhysiqueDraft[];
  bodyDrafts?: BodyDraft[];
}

export async function readDrafts(user: string): Promise<StoredDrafts> {
  const db = await database();
  const record = await idbGet<StoredDrafts>(db, 'drafts', user);
  return record ?? {};
}

export async function saveDrafts(user: string, drafts: StoredDrafts): Promise<void> {
  const db = await database();
  return idbPut(db, 'drafts', drafts, user);
}

export async function clearUserCache(user: string): Promise<void> {
  const db = await database();
  await idbDelete(db, 'accounts', user).catch(() => {});
  await idbDelete(db, 'saved_foods', user).catch(() => {});
  await idbDelete(db, 'mutations', user).catch(() => {});
  await idbDelete(db, 'drafts', user).catch(() => {});
  await idbDelete(db, 'meta', `migrated_v2:${user}`).catch(() => {});
  const allKeys = await idbGetAllKeys(db, 'diary_days').catch(() => []);
  const prefix = `${user}:`;
  for (const key of allKeys) {
    if (typeof key === 'string' && key.startsWith(prefix)) {
      await idbDelete(db, 'diary_days', key).catch(() => {});
    }
  }
}

/**
 * Migration from v1 monolithic LocalData to v2 partitioned stores.
 * Extracts mutations, drafts, saved foods, and dated diary records.
 * Recoverable on quota exceeded or interruption.
 */
export async function migrateV1ToV2(db: IDBDatabase, user: string): Promise<boolean> {
  const metaKey = `migrated_v2:${user}`;
  const alreadyMigrated = await idbGet<boolean>(db, 'meta', metaKey).catch(() => false);
  if (alreadyMigrated) return true;

  const raw = await idbGet<LocalData>(db, 'accounts', user).catch(() => undefined);
  if (!raw) return true;

  try {
    // 1. Separate mutation queue if present
    if (raw.queue && raw.queue.length > 0) {
      await idbPut(db, 'mutations', { queue: raw.queue }, user);
    }

    // 2. Separate drafts if present
    if ((raw.photoDrafts && raw.photoDrafts.length > 0) || (raw.bodyDrafts && raw.bodyDrafts.length > 0)) {
      await idbPut(db, 'drafts', { photoDrafts: raw.photoDrafts ?? [], bodyDrafts: raw.bodyDrafts ?? [] }, user);
    }

    // 3. Separate foods if present
    if (raw.state?.foods && raw.state.foods.length > 0) {
      await idbPut(db, 'saved_foods', { foods: raw.state.foods, revision: raw.state.foodRevision ?? raw.state.revision ?? 0, fetchedAt: Date.now() }, user);
    }

    // 4. Extract dated diary records from state and historical snapshots
    const datesMap = new Map<string, { entries: Map<string, Entry>; day?: Day; revision: number }>();

    const ingestState = (st: AppState) => {
      if (!st) return;
      for (const entry of st.entries ?? []) {
        if (!entry.date) continue;
        let bucket = datesMap.get(entry.date);
        if (!bucket) {
          bucket = { entries: new Map(), revision: st.revision ?? 0 };
          datesMap.set(entry.date, bucket);
        }
        const existing = bucket.entries.get(entry.id);
        if (!existing || (entry.revision ?? 0) >= (existing.revision ?? 0)) {
          bucket.entries.set(entry.id, entry);
        }
        if ((st.revision ?? 0) > bucket.revision) bucket.revision = st.revision;
      }
      for (const day of st.days ?? []) {
        if (!day.date) continue;
        let bucket = datesMap.get(day.date);
        if (!bucket) {
          bucket = { entries: new Map(), revision: st.revision ?? 0 };
          datesMap.set(day.date, bucket);
        }
        if (!bucket.day || (day.revision ?? 0) >= (bucket.day.revision ?? 0)) {
          bucket.day = day;
        }
      }
    };

    if (raw.state) ingestState(raw.state);
    if (raw.history) {
      for (const hist of Object.values(raw.history)) {
        if (hist) ingestState(hist);
      }
    }

    const now = Date.now();
    for (const [date, bucket] of datesMap.entries()) {
      const dayRecord: DatedDiaryDay = {
        date,
        entries: [...bucket.entries.values()].sort((a, b) => (a.time ?? '').localeCompare(b.time ?? '') || a.id.localeCompare(b.id)),
        day: bucket.day,
        revision: bucket.revision,
        fetchedAt: now
      };
      await idbPut(db, 'diary_days', dayRecord, `${user}:${date}`);
    }

    // 5. Clean up bloated history and embedded drafts from the account snapshot in accounts store
    if (raw.history || raw.photoDrafts || raw.bodyDrafts) {
      const cleanState = { ...raw.state };
      const cleanData: LocalData = {
        state: cleanState,
        queue: raw.queue ?? [],
        progress: raw.progress
      };
      await idbPut(db, 'accounts', cleanData, user);
    }

    // 6. Record successful migration marker
    await idbPut(db, 'meta', true, metaKey);
    return true;
  } catch (ex: any) {
    // Gracefully handle storage quota errors or interruption
    if (ex?.name === 'QuotaExceededError' || ex?.code === 22) {
      console.warn('Storage quota exceeded during migration; preserved existing data.');
      return false;
    }
    throw ex;
  }
}

export async function readLocal(user: string): Promise<LocalData | undefined> {
  const db = await database();
  await migrateV1ToV2(db, user).catch(() => {});

  const raw = await idbGet<LocalData>(db, 'accounts', user);
  if (!raw) return undefined;

  const queue = await readMutations(user).catch(() => raw.queue ?? []);
  const drafts = await readDrafts(user).catch(() => ({ photoDrafts: raw.photoDrafts, bodyDrafts: raw.bodyDrafts }));
  const foodsRecord = await readSavedFoods(user).catch(() => undefined);

  const state: AppState = {
    ...raw.state,
    foods: foodsRecord?.foods ?? raw.state?.foods ?? []
  };

  const cacheHasLoadedData=Boolean(foodsRecord&&(foodsRecord.loaded===true||foodsRecord.foods.length>0||foodsRecord.revision===0));

  return {
    ...raw,
    state,
    foodsLoaded: raw.foodsLoaded===true||cacheHasLoadedData||(!foodsRecord&&Boolean(raw.state?.foods?.length)),
    queue,
    photoDrafts: drafts.photoDrafts ?? raw.photoDrafts,
    bodyDrafts: drafts.bodyDrafts ?? raw.bodyDrafts
  };
}

export async function saveLocal(user: string, data: LocalData): Promise<void> {
  const db = await database();
  // Keep the canonical account, queue, drafts, and saved-food snapshot in one
  // transaction. The old implementation opened four transactions for every
  // optimistic update and could leave the stores at different revisions after
  // an interruption. Empty collections are written deliberately: an empty
  // server response is an authoritative deletion, not a reason to retain stale
  // local rows.
  const stores = ['accounts', 'mutations', 'drafts'];
  if (Array.isArray(data.state?.foods)&&data.foodsLoaded!==false) stores.push('saved_foods');
  await new Promise<void>((resolve, reject) => {
    try {
      const tx = db.transaction(stores, 'readwrite');
      tx.objectStore('accounts').put({ state: data.state, progress: data.progress }, user);
      tx.objectStore('mutations').put({ queue: data.queue ?? [] }, user);
      tx.objectStore('drafts').put({ photoDrafts: data.photoDrafts, bodyDrafts: data.bodyDrafts }, user);
      if (stores.includes('saved_foods')) {
        tx.objectStore('saved_foods').put({ foods: data.state.foods, revision: data.state.foodRevision ?? data.state.revision ?? 0, fetchedAt: Date.now(), loaded: true }, user);
      }
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error ?? new Error('Local data transaction aborted'));
    } catch (ex) {
      reject(ex);
    }
  });
}

/** Remove the retired client-side AI scan records when an older cache is reopened. */
export function stripLegacyScanDrafts(data: LocalData): LocalData {
  if (!Object.prototype.hasOwnProperty.call(data, 'scans')) return data;
  const current = { ...data } as LocalData & { scans?: unknown };
  delete current.scans;
  return current;
}
