export const DATABASE_VERSION = 6;

type SchemaDatabase = Pick<IDBDatabase, 'objectStoreNames' | 'createObjectStore' | 'deleteObjectStore'>;

/** Brings the local database from any earlier version to DATABASE_VERSION. */
export function upgradeLocalDatabase(db: SchemaDatabase, oldVersion: number): void {
  const create = (name: string) => { if (!db.objectStoreNames.contains(name)) db.createObjectStore(name); };
  if (oldVersion < 1) create('accounts');
  if (oldVersion < 2) for (const name of ['saved_foods', 'mutations', 'drafts', 'meta']) create(name);
  if (oldVersion < 3) create('food_drafts');
  if (oldVersion < 4) create('food_scans');
  if (oldVersion < 5) { create('push_revocations'); create('push_devices'); }
  // Version 2 to 5 also cached every fetched diary day here, but nothing ever read it back:
  // the account snapshot and the in-memory coordinator serve dated days.
  if (oldVersion < 6 && db.objectStoreNames.contains('diary_days')) db.deleteObjectStore('diary_days');
}
