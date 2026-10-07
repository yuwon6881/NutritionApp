import type { LocalData } from '../types';
import { idbGet, idbPut } from './idb';

/**
 * Migration from v1 monolithic LocalData to v2 partitioned stores.
 * Extracts mutations, drafts, and saved foods. Legacy history snapshots are dropped: the server
 * holds those dates, and no reader of a separate dated-day cache exists.
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
    if (raw.queue && raw.queue.length > 0 && !await idbGet(db,'mutations',user)) {
      await idbPut(db, 'mutations', { queue: raw.queue }, user);
    }

    // 2. Separate drafts if present
    if (((raw.photoDrafts && raw.photoDrafts.length > 0) || (raw.bodyDrafts && raw.bodyDrafts.length > 0)) && !await idbGet(db,'drafts',user)) {
      await idbPut(db, 'drafts', { photoDrafts: raw.photoDrafts ?? [], bodyDrafts: raw.bodyDrafts ?? [] }, user);
    }

    // 3. Separate foods if present
    if (raw.state?.foods && raw.state.foods.length > 0 && !await idbGet(db,'saved_foods',user)) {
      await idbPut(db, 'saved_foods', { foods: raw.state.foods, revision: raw.state.foodRevision ?? raw.state.revision ?? 0, fetchedAt: Date.now() }, user);
    }

    // 4. Clean up bloated history and embedded drafts from the account snapshot in accounts store
    if (raw.history || raw.photoDrafts || raw.bodyDrafts) {
      const cleanState = { ...raw.state };
      const cleanData: LocalData = {
        state: cleanState,
        queue: raw.queue ?? [],
        progress: raw.progress
      };
      await idbPut(db, 'accounts', cleanData, user);
    }

    // 5. Record successful migration marker
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

/** Remove the retired client-side AI scan records when an older cache is reopened. */
export function stripLegacyScanDrafts(data: LocalData): LocalData {
  if (!Object.prototype.hasOwnProperty.call(data, 'scans')) return data;
  const current = { ...data } as LocalData & { scans?: unknown };
  delete current.scans;
  return current;
}
