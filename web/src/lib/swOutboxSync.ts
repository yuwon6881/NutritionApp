import type { AppState, LocalData, Mutation, MutationConflict, SyncAcknowledgement } from '../types';
import { retainMutationConflict } from './mutationConflicts';
import { acknowledgeLocalWrite } from './nutritionAcknowledgement';
import { markForRetry, retireRejectedMutation, wireMutation } from './projection';
import { mergeRetained } from './retainedMerge';
import { classifySyncStatus, parseRetryAfterMs } from './syncFailureStatus';

interface StoredMutations {
  queue?: Mutation[];
  conflicts?: MutationConflict[];
}

interface StoredAccount {
  state?: AppState;
  progress?: LocalData['progress'];
  foodsLoaded?: boolean;
}

interface DispatchLease {
  owner?: string;
  until?: number;
}

function openExistingLocalDatabase(): Promise<IDBDatabase | null> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      resolve(null);
      return;
    }
    let missing = false;
    const request = indexedDB.open('nutrition-local');
    request.onupgradeneeded = () => {
      // Never initialize an empty v1 database ahead of the main app schema upgrade.
      missing = true;
      try { request.transaction?.abort(); } catch { /* already aborted */ }
    };
    request.onsuccess = () => {
      const db = request.result;
      if (missing || !db.objectStoreNames.contains('mutations')) {
        db.close();
        resolve(null);
        return;
      }
      resolve(db);
    };
    request.onerror = () => {
      if (missing) resolve(null);
      else reject(request.error ?? new Error('Could not open local Nutrition storage.'));
    };
  });
}

function readAllMutationKeys(db: IDBDatabase): Promise<string[]> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction('mutations', 'readonly');
    const request = tx.objectStore('mutations').getAllKeys();
    request.onsuccess = () => resolve(request.result.filter((key): key is string => typeof key === 'string'));
    request.onerror = () => reject(request.error ?? new Error('Could not read queued accounts.'));
  });
}

function readSnapshotForAccount(db: IDBDatabase, accountId: string): Promise<{
  mutations: StoredMutations;
  lease?: DispatchLease;
}> {
  return new Promise((resolve, reject) => {
    const stores = db.objectStoreNames.contains('meta') ? ['mutations', 'meta'] : ['mutations'];
    const tx = db.transaction(stores, 'readonly');
    const mutReq = tx.objectStore('mutations').get(accountId);
    const leaseReq = stores.includes('meta') ? tx.objectStore('meta').get(`dispatch:${accountId}`) : undefined;
    tx.oncomplete = () => resolve({
      mutations: (mutReq.result as StoredMutations | undefined) ?? {},
      lease: leaseReq?.result as DispatchLease | undefined
    });
    tx.onerror = () => reject(tx.error ?? new Error('Could not read queued mutations.'));
    tx.onabort = () => reject(tx.error ?? new Error('Queued mutation read aborted.'));
  });
}

function commitMutationUpdate(
  db: IDBDatabase,
  accountId: string,
  expectedQueue: Mutation[],
  update: (current: { queue: Mutation[]; conflicts: MutationConflict[]; account?: StoredAccount }) => {
    queue: Mutation[];
    conflicts: MutationConflict[];
    account?: StoredAccount;
  }
): Promise<void> {
  return new Promise((resolve, reject) => {
    const stores = db.objectStoreNames.contains('accounts') ? ['mutations', 'accounts'] : ['mutations'];
    const tx = db.transaction(stores, 'readwrite');
    const mutStore = tx.objectStore('mutations');
    const accStore = stores.includes('accounts') ? tx.objectStore('accounts') : undefined;
    const mutReq = mutStore.get(accountId);
    const accReq = accStore?.get(accountId);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('Could not save synced mutations.'));
    tx.onabort = () => reject(tx.error ?? new Error('Mutation save aborted.'));
    let savedMutations: StoredMutations | undefined;
    let savedAccount: StoredAccount | undefined;
    let pending = accReq ? 2 : 1;
    const applyIfReady = () => {
      pending--;
      if (pending > 0) return;
      const saved = savedMutations ?? {};
      const result = update({
        queue: saved.queue ?? [],
        conflicts: saved.conflicts ?? [],
        account: savedAccount
      });
      const mergedQueue = mergeRetained(saved.queue ?? [], expectedQueue, result.queue, item => item.id);
      const mergedConflicts = mergeRetained(saved.conflicts ?? [], saved.conflicts ?? [], result.conflicts, item => item.id);
      mutStore.put({ queue: mergedQueue, conflicts: mergedConflicts }, accountId);
      if (accStore && result.account?.state) {
        const currentRevision = savedAccount?.state?.revision ?? 0;
        if (result.account.state.revision >= currentRevision) {
          accStore.put({
            state: { ...result.account.state, foods: [] },
            progress: result.account.progress,
            foodsLoaded: result.account.foodsLoaded
          }, accountId);
        }
      }
    };
    mutReq.onsuccess = () => { savedMutations = mutReq.result as StoredMutations | undefined; applyIfReady(); };
    if (accReq) accReq.onsuccess = () => { savedAccount = accReq.result as StoredAccount | undefined; applyIfReady(); };
  });
}

function notifyAccountChanged(accountId: string): void {
  if (typeof BroadcastChannel === 'undefined') return;
  try {
    const channel = new BroadcastChannel('nutrition-retained-work');
    channel.postMessage({ account: accountId });
    channel.close();
  } catch {
    // Best-effort tab notification.
  }
}

async function readErrorMessage(response: Response, fallback: string): Promise<string> {
  try {
    const json = await response.json() as { message?: unknown };
    return typeof json.message === 'string' && json.message ? json.message : fallback;
  } catch {
    return fallback;
  }
}

/**
 * Drains retained outbox mutations from the Service Worker `sync` event.
 * When no visible tab is open, Undo holds are waived so logged items sync in the background.
 */
export async function drainOutboxInServiceWorker(
  clients: Pick<Clients, 'matchAll'>,
  origin: string
): Promise<void> {
  const db = await openExistingLocalDatabase();
  if (!db) return;
  try {
    const windows = await clients.matchAll({ type: 'window', includeUncontrolled: true });
    const hasVisibleClient = windows.some(client => (client as WindowClient).visibilityState === 'visible');
    const accounts = await readAllMutationKeys(db);
    for (const accountId of accounts) {
      await drainAccountInServiceWorker(db, accountId, origin, hasVisibleClient);
    }
  } finally {
    db.close();
  }
}

async function drainAccountInServiceWorker(
  db: IDBDatabase,
  accountId: string,
  origin: string,
  hasVisibleClient: boolean
): Promise<void> {
  for (;;) {
    const { mutations, lease } = await readSnapshotForAccount(db, accountId);
    if (hasVisibleClient && lease?.until && lease.until > Date.now()) return;
    const queue = mutations.queue ?? [];
    const op = queue[0];
    if (!op) return;
    if (hasVisibleClient && op.holdUntil !== undefined && op.holdUntil > Date.now()) return;
    if ((op.retryAt ?? 0) > Date.now()) throw new Error('Sync retry scheduled.');

    let response: Response;
    try {
      response = await fetch(`${origin}/api/sync`, {
        method: 'POST',
        credentials: 'same-origin',
        cache: 'no-store',
        headers: {
          'Content-Type': 'application/json',
          'X-Nutrition-Request': '1',
          'X-Nutrition-Account': accountId,
          'X-Fitness-Integration-Dispatch': 'deferred'
        },
        body: JSON.stringify(wireMutation(op))
      });
    } catch {
      await commitMutationUpdate(db, accountId, queue, current => ({
        queue: markForRetry(current.queue, op, Date.now() + 5000),
        conflicts: current.conflicts
      }));
      notifyAccountChanged(accountId);
      throw new Error('Background sync network error.');
    }

    if (response.ok) {
      const ack = await response.json() as SyncAcknowledgement;
      await commitMutationUpdate(db, accountId, queue, current => {
        if (!current.account?.state) {
          return {
            queue: retireRejectedMutation(current.queue, op),
            conflicts: current.conflicts
          };
        }
        const acknowledged = acknowledgeLocalWrite({
          state: current.account.state,
          progress: current.account.progress,
          foodsLoaded: current.account.foodsLoaded,
          queue: current.queue,
          conflicts: current.conflicts
        }, op, ack.revision, ack);
        return {
          queue: acknowledged.queue,
          conflicts: acknowledged.conflicts ?? current.conflicts,
          account: {
            state: acknowledged.state,
            progress: acknowledged.progress,
            foodsLoaded: op.kind === 'food' ? false : current.account.foodsLoaded
          }
        };
      });
      notifyAccountChanged(accountId);
      continue;
    }

    const failure = classifySyncStatus(response.status);
    if (failure === 'session-expired') return;

    if (failure === 'conflict') {
      const message = await readErrorMessage(response, 'This change conflicts with saved data.');
      await commitMutationUpdate(db, accountId, queue, current => {
        const next = retainMutationConflict({
          state: current.account?.state ?? ({} as AppState),
          queue: current.queue,
          conflicts: current.conflicts
        }, op, message, Date.now());
        return { queue: next.queue, conflicts: next.conflicts ?? current.conflicts };
      });
      notifyAccountChanged(accountId);
      continue;
    }

    if (failure === 'rejected') {
      await commitMutationUpdate(db, accountId, queue, current => ({
        queue: retireRejectedMutation(current.queue, op),
        conflicts: current.conflicts
      }));
      notifyAccountChanged(accountId);
      continue;
    }

    const retryMs = parseRetryAfterMs(response.headers.get('Retry-After'), 5000);
    await commitMutationUpdate(db, accountId, queue, current => ({
      queue: markForRetry(current.queue, op, Date.now() + retryMs),
      conflicts: current.conflicts
    }));
    notifyAccountChanged(accountId);
    throw new Error(`Background sync deferred (${response.status}).`);
  }
}
