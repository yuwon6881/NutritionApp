import type { FoodScanDraft } from './foodScans';
import { foodBasketDraftKey } from './local';

/** Compare and attach in one transaction so a newly saved draft is never silently overwritten. */
export function writeIncomingPhotoDraft(db: IDBDatabase, accountId: string, incoming: FoodScanDraft,
  expected: FoodScanDraft | undefined): Promise<boolean> {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction('food_scans', 'readwrite');
    let attached = false;
    let failure: unknown;
    transaction.oncomplete = () => resolve(attached);
    transaction.onerror = () => reject(failure ?? transaction.error ?? new Error('The image draft could not be saved.'));
    transaction.onabort = () => reject(failure ?? transaction.error ?? new Error('The image draft save was interrupted.'));
    const store = transaction.objectStore('food_scans');
    const key = foodBasketDraftKey(accountId, incoming.date);
    const read = store.get(key);
    read.onsuccess = () => {
      const current = read.result as FoodScanDraft | undefined;
      if (current?.id === incoming.id) { attached = true; return; }
      if (JSON.stringify(current) !== JSON.stringify(expected)) return;
      try {
        store.put({ ...incoming, updatedAt: Date.now() }, key);
        attached = true;
      } catch (error) { failure = error; transaction.abort(); }
    };
  });
}
