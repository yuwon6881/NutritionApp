/**
 * Copies the database written before the app was renamed from Nourish into the current one. Loaded
 * only while a copy is pending; delete it together with legacyStorage.ts.
 */
import {LEGACY_IMPORT_KEY,type LegacyImportState} from './legacyStorage';

export const LEGACY_DATABASE_NAME = 'nourish-local';

const LEGACY_IMPORT_TIMEOUT_MS = 10_000;

/**
 * Opens the old database one version above the last app that used it, so any older tab still
 * holding it receives `versionchange`, closes, and can no longer write. Resolves null when no old
 * database exists; aborting the creation upgrade leaves nothing behind.
 */
function openLegacyDatabase(fenceVersion: number): Promise<IDBDatabase | null> {
  return new Promise((resolve, reject) => {
    let absent = false;
    const request = indexedDB.open(LEGACY_DATABASE_NAME, fenceVersion);
    request.onupgradeneeded = event => {
      if (event.oldVersion !== 0) return;
      absent = true;
      request.transaction?.abort();
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = event => {
      if (!absent) { reject(request.error ?? new Error('The previous local database could not be opened.')); return; }
      event.preventDefault();
      resolve(null);
    };
  });
}

type StoreContents = { keys: IDBValidKey[]; values: unknown[] };

function readStores(db: IDBDatabase, names: string[]): Promise<Map<string, StoreContents>> {
  return new Promise((resolve, reject) => {
    const contents = new Map<string, StoreContents>();
    if (names.length === 0) { resolve(contents); return; }
    const transaction = db.transaction(names, 'readonly');
    for (const name of names) {
      const entry: StoreContents = { keys: [], values: [] };
      contents.set(name, entry);
      // Both requests walk the store in key order, so keys and values pair by index.
      const store = transaction.objectStore(name);
      const keys = store.getAllKeys();
      keys.onsuccess = () => { entry.keys = keys.result; };
      const values = store.getAll();
      values.onsuccess = () => { entry.values = values.result; };
    }
    transaction.oncomplete = () => resolve(contents);
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error ?? new Error('Reading the previous local database was interrupted.'));
  });
}

/** Writes every copied record and the finished marker in one transaction: all of it lands or none. */
function writeImport(db: IDBDatabase, contents: Map<string, StoreContents>): Promise<void> {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([...contents.keys(), 'meta'], 'readwrite');
    for (const [name, { keys, values }] of contents) {
      const store = transaction.objectStore(name);
      keys.forEach((key, index) => store.put(values[index], key));
    }
    transaction.objectStore('meta').put('done' satisfies LegacyImportState, LEGACY_IMPORT_KEY);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error ?? new Error('Copying the previous local database was interrupted.'));
  });
}

async function copyLegacyDatabase(target: IDBDatabase, fenceVersion: number): Promise<void> {
  const legacy = await openLegacyDatabase(fenceVersion);
  if (!legacy) {
    await writeImport(target, new Map());
    return;
  }
  try {
    const shared = [...legacy.objectStoreNames].filter(name => target.objectStoreNames.contains(name));
    await writeImport(target, await readStores(legacy, shared));
  } finally {
    legacy.close();
  }
  // Only after the copy has committed. A tab that still blocks deletion delays it, never the copy.
  try { indexedDB.deleteDatabase(LEGACY_DATABASE_NAME); } catch { /* The copy is complete; the old database is only unused space. */ }
}

/**
 * Copies the old database into a freshly created current one. `pending` is written by the upgrade
 * that created the current database, so an existing installation, or one whose data was later
 * wiped, never imports the old data again.
 */
export function importLegacyDatabase(target: IDBDatabase, state: LegacyImportState | undefined, fenceVersion: number): Promise<void> {
  if (state !== 'pending') return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('The previous local database did not open in time.')), LEGACY_IMPORT_TIMEOUT_MS);
    copyLegacyDatabase(target, fenceVersion).then(resolve, reject).finally(() => clearTimeout(timeout));
  });
}
