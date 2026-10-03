/**
 * Browser storage written before the app was renamed from Nourish. Each installation moves its
 * data to the current names once, on its first start after the rename; delete this module once no
 * installation can still hold the old names.
 */

type KeyStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

/** Old localStorage key → current key. */
export const LEGACY_LOCAL_STORAGE_KEYS: ReadonlyArray<readonly [string, string]> = [
  ['nourish-account', 'nutrition-account'],
  ['nourish-signed-out', 'nutrition-signed-out'],
  ['nourish-theme', 'nutrition-theme'],
  ['nourish-haptics', 'nutrition-haptics'],
  ['nourish-push-device-id', 'nutrition-push-device-id'],
  ['nourish-pending-shortcut-v1', 'nutrition-pending-shortcut-v1'],
];

/**
 * Moves each old key to its current name. A value already under the current name wins, and an old
 * key is removed only after its value is safely stored, so a full or failing storage keeps it.
 */
export function migrateLegacyLocalStorage(storage: KeyStorage): void {
  for (const [legacy, current] of LEGACY_LOCAL_STORAGE_KEYS) {
    try {
      const value = storage.getItem(legacy);
      if (value === null) continue;
      if (storage.getItem(current) === null) storage.setItem(current, value);
      storage.removeItem(legacy);
    } catch {
      // Storage can be unavailable or full; the old key stays and the move is retried next start.
    }
  }
}

/** `meta` key recording whether the old database still has to be copied into this one. */
export const LEGACY_IMPORT_KEY = 'legacy-database-import';
export type LegacyImportState = 'pending' | 'done';
