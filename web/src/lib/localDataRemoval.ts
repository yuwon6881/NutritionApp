import type { LocalData, Mutation } from '../types';
import type { FoodScanDraft } from './foodScans';
import { database, isBasketLine, isFoodScanDraft, type StoredDrafts } from './local';
import { idbGet, idbGetAllKeys } from './idb';

export async function countFoodScanDrafts(user: string): Promise<number> {
  const db = await database();
  const keys = await idbGetAllKeys(db, 'food_scans');
  const prefix = `${user}:`;
  let count = 0;
  for (const key of keys) {
    if (typeof key !== 'string' || !key.startsWith(prefix)) continue;
    const record = await idbGet<FoodScanDraft>(db, 'food_scans', key);
    if (isFoodScanDraft(record)) count++;
  }
  return count;
}

export async function countFoodBasketDrafts(user: string): Promise<number> {
  const db = await database();
  const keys = await idbGetAllKeys(db, 'food_drafts');
  const prefix = `${user}:`;
  let count = 0;
  for (const key of keys) {
    if (typeof key !== 'string' || !key.startsWith(prefix)) continue;
    const record = await idbGet<{ version: number; lines: unknown }>(db, 'food_drafts', key);
    if (record?.version === 1 && Array.isArray(record.lines) && record.lines.some(isBasketLine)) count++;
  }
  return count;
}

export interface AccountLocalWorkCounts {
  outboxMutations: number;
  photoDrafts: number;
  bodyDrafts: number;
  foodBasketDrafts: number;
  scanDrafts: number;
  total: number;
}

export async function countAccountLocalWork(user: string): Promise<AccountLocalWorkCounts> {
  const account = user.trim();
  if (!account) throw new Error('A signed-in account is required to count local Nutrition work.');
  const db = await database();
  const [legacy, mutationRecord, storedDrafts, foodBasketDrafts, scanDrafts] = await Promise.all([
    idbGet<LocalData>(db, 'accounts', account),
    idbGet<{ queue?: Mutation[] }>(db, 'mutations', account),
    idbGet<StoredDrafts>(db, 'drafts', account),
    countFoodBasketDrafts(account),
    countFoodScanDrafts(account)
  ]);
  const mutations = Array.isArray(mutationRecord?.queue) ? mutationRecord.queue : legacy?.queue;
  const photoDrafts = Array.isArray(storedDrafts?.photoDrafts) ? storedDrafts.photoDrafts : legacy?.photoDrafts;
  const bodyDrafts = Array.isArray(storedDrafts?.bodyDrafts) ? storedDrafts.bodyDrafts : legacy?.bodyDrafts;
  const outboxMutations = Array.isArray(mutations) ? mutations.length : 0;
  const photoDraftCount = Array.isArray(photoDrafts) ? photoDrafts.length : 0;
  const bodyDraftCount = Array.isArray(bodyDrafts) ? bodyDrafts.length : 0;
  return {
    outboxMutations,
    photoDrafts: photoDraftCount,
    bodyDrafts: bodyDraftCount,
    foodBasketDrafts,
    scanDrafts,
    total: outboxMutations + photoDraftCount + bodyDraftCount + foodBasketDrafts + scanDrafts
  };
}

export async function clearUserCache(user: string): Promise<void> {
  const account = user.trim();
  if (!account) throw new Error('A signed-in account is required to remove local Nutrition data.');
  const db = await database();
  const transaction = db.transaction([
    'accounts', 'saved_foods', 'mutations', 'drafts', 'food_drafts', 'food_scans', 'meta', 'diary_days'
  ], 'readwrite');
  const completed = new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error('Local Nutrition data could not be removed.'));
    transaction.onabort = () => reject(transaction.error ?? new Error('Local Nutrition data removal was interrupted.'));
  });
  try {
    transaction.objectStore('accounts').delete(account);
    transaction.objectStore('saved_foods').delete(account);
    transaction.objectStore('mutations').delete(account);
    transaction.objectStore('drafts').delete(account);
    transaction.objectStore('meta').delete(`migrated_v2:${account}`);
    deleteAccountRecords(transaction, 'food_drafts', account);
    deleteAccountRecords(transaction, 'food_scans', account);
    deleteAccountRecords(transaction, 'diary_days', account);
  } catch (error) {
    try { transaction.abort(); } catch { /* transaction may already have completed */ }
    await completed.catch(() => {});
    throw error;
  }
  await completed;
}

function deleteAccountRecords(transaction: IDBTransaction, storeName: string, account: string) {
  const prefix = `${account}:`;
  const request = transaction.objectStore(storeName).openCursor();
  request.onsuccess = () => {
    const cursor = request.result;
    if (!cursor) return;
    if (typeof cursor.key === 'string' && cursor.key.startsWith(prefix)) cursor.delete();
    cursor.continue();
  };
}
