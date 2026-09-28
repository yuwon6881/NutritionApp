import type {LocalData} from '../types';

/** Persist immutable partitions together, without cloning unchanged photo/food payloads. */
export async function writeLocalSnapshot(
  db: IDBDatabase, user: string, data: LocalData, previous?: LocalData, retireFoodBasketDate?: string
): Promise<void> {
  const accountChanged = !previous || data.state !== previous.state || data.progress !== previous.progress || data.foodsLoaded !== previous.foodsLoaded;
  const queueChanged = !previous || data.queue !== previous.queue;
  const draftsChanged = !previous || data.photoDrafts !== previous.photoDrafts || data.bodyDrafts !== previous.bodyDrafts;
  const foodsChanged = data.foodsLoaded !== false && (!previous || previous.foodsLoaded === false ||
    data.state.foods !== previous.state.foods || data.state.foodRevision !== previous.state.foodRevision);
  const stores: string[] = [];
  if (accountChanged) stores.push('accounts');
  if (queueChanged) stores.push('mutations');
  if (draftsChanged) stores.push('drafts');
  if (foodsChanged) stores.push('saved_foods');
  if (retireFoodBasketDate !== undefined) stores.push('food_drafts');
  if (!stores.length) return;
  await new Promise<void>((resolve, reject) => {
    let tx: IDBTransaction | undefined;
    try {
      tx = db.transaction(stores, 'readwrite');
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx?.error);
      tx.onabort = () => reject(tx?.error ?? new Error('Local data transaction aborted'));
      if (accountChanged) {
        // Saved foods are authoritative in their own partition. Empty fallbacks remain
        // readable by older clients without duplicating the large collection.
        tx.objectStore('accounts').put({state:{...data.state,foods:[]},progress:data.progress,foodsLoaded:data.foodsLoaded}, user);
      }
      if (queueChanged) tx.objectStore('mutations').put({queue:data.queue ?? []}, user);
      if (draftsChanged) tx.objectStore('drafts').put({photoDrafts:data.photoDrafts,bodyDrafts:data.bodyDrafts}, user);
      if (foodsChanged) tx.objectStore('saved_foods').put({foods:data.state.foods,
        revision:data.state.foodRevision ?? data.state.revision ?? 0,fetchedAt:Date.now(),loaded:true}, user);
      if (retireFoodBasketDate !== undefined) tx.objectStore('food_drafts').delete(`${user}:${retireFoodBasketDate}`);
    } catch (error) {
      // A synchronous structured-clone/quota failure must not commit preceding puts.
      try { tx?.abort(); } catch { /* Already settled. */ }
      reject(error);
    }
  });
}

/** Atomically remove legacy duplication only after its authoritative partition exists. */
export async function compactAccountSnapshot(db: IDBDatabase, user: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(['accounts','saved_foods'], 'readwrite');
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error('Account compaction aborted'));
    const accounts = tx.objectStore('accounts');
    const request = accounts.get(user);
    request.onsuccess = () => {
      const raw = request.result as LocalData | undefined;
      if (!raw?.state.foods.length) return;
      const foods = tx.objectStore('saved_foods');
      const foodRequest = foods.get(user);
      foodRequest.onsuccess = () => {
        if (!foodRequest.result) foods.put({foods:raw.state.foods,
          revision:raw.state.foodRevision ?? raw.state.revision,fetchedAt:Date.now(),loaded:true},user);
        accounts.put({...raw,state:{...raw.state,foods:[]}},user);
      };
    };
  });
}
