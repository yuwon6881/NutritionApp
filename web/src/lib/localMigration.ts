import type { AppState, DatedDiaryDay, Day, Entry, LocalData } from '../types';
import { idbGet, idbPut } from './idb';

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

/** Remove the retired client-side AI scan records when an older cache is reopened. */
export function stripLegacyScanDrafts(data: LocalData): LocalData {
  if (!Object.prototype.hasOwnProperty.call(data, 'scans')) return data;
  const current = { ...data } as LocalData & { scans?: unknown };
  delete current.scans;
  return current;
}
