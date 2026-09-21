import type { AppState, BodyDraft, DatedDiaryDay, Food, LocalData, Mutation, PhysiqueDraft } from '../types';
import type { SavedFoodsCache } from './savedFoods';
import type { BasketLine } from './foodBasket';
import type { FoodScanDraft } from './foodScans';
import { idbDelete, idbGet, idbGetAllKeys, idbPut } from './idb';
import { migrateV1ToV2 } from './localMigration';

export { idbDelete, idbGet, idbGetAllKeys, idbPut };
export * from './localMigration';
export * from './localDataRemoval';
export * from './push/deviceStorage';

let connection: Promise<IDBDatabase> | undefined;
let databaseInvalidated = false;
let databaseFailure = '';

const DATABASE_VERSION = 5;
const DATABASE_OPEN_TIMEOUT_MS = 10_000;

export type LocalDatabaseErrorCode = 'timeout' | 'unavailable' | 'versionchange';

export class LocalDatabaseError extends Error {
  constructor(readonly code: LocalDatabaseErrorCode, message: string) {
    super(message);
    this.name = 'LocalDatabaseError';
  }
}

export function resetDatabaseConnectionForTests(): void {
  connection = undefined;
  databaseInvalidated = false;
  databaseFailure = '';
}

export function getLocalDatabaseFailure(): string {
  return databaseFailure;
}

function reportDatabaseFailure(error: LocalDatabaseError): void {
  databaseFailure = error.message;
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('nutrition-local-database-error', { detail: error.message }));
}

export function database(): Promise<IDBDatabase> {
  if (databaseInvalidated) {
    return Promise.reject(new LocalDatabaseError('versionchange', 'Nutrition storage changed in another tab. Reload the app before continuing.'));
  }
  if (connection) return connection;

  let opening: Promise<IDBDatabase>;
  opening = new Promise<IDBDatabase>((resolve, reject) => {
    let settled = false;
    let blocked = false;
    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      const error = blocked
        ? new LocalDatabaseError('timeout', 'Local Nutrition data is blocked by another open tab. Close older Nutrition tabs and reload; unsynced data has not been submitted.')
        : new LocalDatabaseError('timeout', 'Local Nutrition data storage did not open. Reload the app; unsynced data has not been submitted.');
      reportDatabaseFailure(error);
      reject(error);
    }, DATABASE_OPEN_TIMEOUT_MS);
    let request: IDBOpenDBRequest;
    try {
      request = indexedDB.open('nourish-local', DATABASE_VERSION);
    } catch {
      clearTimeout(timeout);
      settled = true;
      const error = new LocalDatabaseError('unavailable', 'Local Nutrition data storage is unavailable. Reload the app; unsynced data has not been submitted.');
      reportDatabaseFailure(error);
      reject(error);
      return;
    }
    request.onblocked = () => { blocked = true; };
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
      if (oldVersion < 3 && !db.objectStoreNames.contains('food_drafts')) {
        db.createObjectStore('food_drafts');
      }
      if (oldVersion < 4 && !db.objectStoreNames.contains('food_scans')) {
        db.createObjectStore('food_scans');
      }
      if (oldVersion < 5 && !db.objectStoreNames.contains('push_revocations')) {
        db.createObjectStore('push_revocations');
      }
      if (oldVersion < 5 && !db.objectStoreNames.contains('push_devices')) {
        db.createObjectStore('push_devices');
      }
    };
    request.onsuccess = () => {
      const db = request.result;
      db.onversionchange = () => {
        db.close();
        databaseInvalidated = true;
        if (connection === opening) connection = undefined;
        const error = new LocalDatabaseError('versionchange', 'Nutrition storage changed in another tab. Reload the app before continuing; unsynced data has not been submitted.');
        reportDatabaseFailure(error);
      };
      if (settled) {
        db.close();
        return;
      }
      settled = true;
      clearTimeout(timeout);
      databaseInvalidated = false;
      databaseFailure = '';
      resolve(db);
    };
    request.onerror = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      const error = new LocalDatabaseError('unavailable', 'Local Nutrition data storage could not be opened. Reload the app; unsynced data has not been submitted.');
      reportDatabaseFailure(error);
      reject(error);
    };
  });
  connection = opening;
  return opening;
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

export async function readFoodBasketDraft(user: string, date: string): Promise<BasketLine[]> {
  const db = await database();
  const record = await idbGet<{ version: number; lines: unknown }>(db, 'food_drafts', foodBasketDraftKey(user, date));
  if (record?.version !== 1 || !Array.isArray(record.lines)) return [];
  return record.lines.filter(isBasketLine);
}

export function isBasketLine(value: unknown): value is BasketLine {
  if (!value || typeof value !== 'object') return false;
  const line = value as Partial<BasketLine>;
  const finiteOrNull = (number: unknown) => number === null || (typeof number === 'number' && Number.isFinite(number));
  return typeof line.key === 'string' && typeof line.name === 'string' && typeof line.source === 'string' &&
    typeof line.quantity === 'number' && Number.isFinite(line.quantity) && line.quantity > 0 &&
    (line.unit === 'g' || line.unit === 'serving') && typeof line.calories === 'number' && Number.isFinite(line.calories) &&
    finiteOrNull(line.protein) && finiteOrNull(line.carbs) && finiteOrNull(line.fat) && finiteOrNull(line.fiber) &&
    (line.portionLabel === null || typeof line.portionLabel === 'string') && finiteOrNull(line.portionGrams) &&
    Array.isArray(line.portions) && line.portions.every(portion => typeof portion?.label === 'string' &&
      typeof portion.grams === 'number' && Number.isFinite(portion.grams) && portion.grams > 0);
}

export async function saveFoodBasketDraft(user: string, date: string, lines: BasketLine[]): Promise<void> {
  const db = await database();
  const key = foodBasketDraftKey(user, date);
  if (lines.length === 0) return idbDelete(db, 'food_drafts', key);
  return idbPut(db, 'food_drafts', { version: 1, updatedAt: Date.now(), lines }, key);
}

export function foodBasketDraftKey(user: string, date: string): string {
  return `${user}:${date}`;
}

export function isFoodBasketDraftKeyLoaded(loadedKey: string | null, user: string, date: string): boolean {
  return loadedKey === foodBasketDraftKey(user, date);
}

export async function readFoodScanDraft(user: string, date: string): Promise<FoodScanDraft | undefined> {
  const db = await database();
  const record = await idbGet<FoodScanDraft>(db, 'food_scans', foodBasketDraftKey(user, date));
  return isFoodScanDraft(record, date) ? record : undefined;
}

export async function saveFoodScanDraft(user: string, draft: FoodScanDraft): Promise<void> {
  if (!isFoodScanDraft(draft)) throw new Error('The saved food scan draft is invalid.');
  const db = await database();
  await idbPut(db, 'food_scans', { ...draft, version: 1, updatedAt: Date.now() }, foodBasketDraftKey(user, draft.date));
  notifyFoodScanDraftsChanged();
}

export async function deleteFoodScanDraft(user: string, date: string): Promise<void> {
  const db = await database();
  await idbDelete(db, 'food_scans', foodBasketDraftKey(user, date));
  notifyFoodScanDraftsChanged();
}

export function notifyFoodScanDraftsChanged(): void {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event('nutrition-scan-drafts-changed'));
}

export function isFoodScanDraft(value: unknown, date?: string): value is FoodScanDraft {
  if (!value || typeof value !== 'object') return false;
  const draft = value as Partial<FoodScanDraft>;
  return draft.version === 1 && typeof draft.id === 'string' && draft.id.length > 0 &&
    typeof draft.date === 'string' && (!date || draft.date === date) &&
    ['photo', 'label', 'description'].includes(draft.mode ?? '') &&
    typeof draft.description === 'string' &&
    (draft.imageBase64 === null || typeof draft.imageBase64 === 'string') &&
    ['captured', 'submitted', 'review', 'failed'].includes(draft.status ?? '') &&
    (draft.resultJson == null || typeof draft.resultJson === 'string') &&
    (draft.error == null || typeof draft.error === 'string') &&
    (draft.pendingBarcode == null || (typeof draft.pendingBarcode.code === 'string' &&
      (draft.pendingBarcode.purpose === 'log' || draft.pendingBarcode.purpose === 'recipe')));
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

  const cacheHasLoadedData = Boolean(foodsRecord && (foodsRecord.loaded === true || foodsRecord.foods.length > 0 || foodsRecord.revision === 0));

  return {
    ...raw,
    state,
    foodsLoaded: raw.foodsLoaded === true || cacheHasLoadedData || (!foodsRecord && Boolean(raw.state?.foods?.length)),
    queue,
    photoDrafts: drafts.photoDrafts ?? raw.photoDrafts,
    bodyDrafts: drafts.bodyDrafts ?? raw.bodyDrafts
  };
}

export async function saveLocal(user: string, data: LocalData): Promise<void> {
  const db = await database();
  return writeLocalSnapshot(db, user, data);
}

export async function saveLocalAndRetireFoodBasketDraft(user: string, data: LocalData, date: string): Promise<void> {
  const db = await database();
  return writeLocalSnapshot(db, user, data, date);
}

async function writeLocalSnapshot(db: IDBDatabase, user: string, data: LocalData, retireFoodBasketDate?: string): Promise<void> {
  // Keep the canonical account, queue, drafts, and saved-food snapshot in one
  // transaction. The old implementation opened four transactions for every
  // optimistic update and could leave the stores at different revisions after
  // an interruption. Empty collections are written deliberately: an empty
  // server response is an authoritative deletion, not a reason to retain stale
  // local rows.
  const stores = ['accounts', 'mutations', 'drafts'];
  if (Array.isArray(data.state?.foods) && data.foodsLoaded !== false) stores.push('saved_foods');
  if (retireFoodBasketDate !== undefined) stores.push('food_drafts');
  await new Promise<void>((resolve, reject) => {
    try {
      const tx = db.transaction(stores, 'readwrite');
      tx.objectStore('accounts').put({ state: data.state, progress: data.progress }, user);
      tx.objectStore('mutations').put({ queue: data.queue ?? [] }, user);
      tx.objectStore('drafts').put({ photoDrafts: data.photoDrafts, bodyDrafts: data.bodyDrafts }, user);
      if (stores.includes('saved_foods')) {
        tx.objectStore('saved_foods').put({ foods: data.state.foods, revision: data.state.foodRevision ?? data.state.revision ?? 0, fetchedAt: Date.now(), loaded: true }, user);
      }
      if (retireFoodBasketDate !== undefined) {
        tx.objectStore('food_drafts').delete(foodBasketDraftKey(user, retireFoodBasketDate));
      }
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error ?? new Error('Local data transaction aborted'));
    } catch (ex) {
      reject(ex);
    }
  });
}
