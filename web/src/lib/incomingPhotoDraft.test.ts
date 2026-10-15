import { describe, expect, it, vi } from 'vitest';
import type { FoodScanDraft } from './foodScans';
import { writeIncomingPhotoDraft } from './incomingPhotoDraft';

const draft: FoodScanDraft = { version: 1, id: 'incoming', date: '2026-10-15', mode: 'photo',
  description: '', imageBase64: 'prepared', status: 'captured' };
function database(current?: FoodScanDraft, fail = false) {
  let saved = current;
  const put = vi.fn((value: FoodScanDraft) => { if (fail) throw new Error('disk full'); saved = value; });
  const transaction = vi.fn(() => {
    const tx = { oncomplete: null as (() => void) | null, onerror: null, onabort: null as (() => void) | null,
      error: null, objectStore: () => ({ put, get: () => {
        const request = { result: current, onsuccess: null as (() => void) | null };
        queueMicrotask(() => request.onsuccess?.());
        return request;
      } }), abort: () => { queueMicrotask(() => tx.onabort?.()); } };
    queueMicrotask(() => queueMicrotask(() => { if (!fail) tx.oncomplete?.(); }));
    return tx;
  });
  return { db: { transaction } as unknown as IDBDatabase, put, transaction, saved: () => saved };
}
describe('incoming image attachment', () => {
  it('persists an account-scoped captured draft without starting analysis', async () => {
    const storage = database();
    expect(await writeIncomingPhotoDraft(storage.db, 'account', draft, undefined)).toBe(true);
    expect(storage.put).toHaveBeenCalledWith(expect.objectContaining({ status: 'captured', imageBase64: 'prepared' }), 'account:2026-10-15');
    expect(storage.transaction).toHaveBeenCalledWith('food_scans', 'readwrite');
  });
  it('keeps a draft unless the exact version the user reviewed is being replaced', async () => {
    const existing = { ...draft, id: 'existing', updatedAt: 1 };
    const storage = database(existing);
    expect(await writeIncomingPhotoDraft(storage.db, 'account', draft, undefined)).toBe(false);
    expect(await writeIncomingPhotoDraft(storage.db, 'account', draft, { ...existing, updatedAt: 0 })).toBe(false);
    expect(storage.put).not.toHaveBeenCalled();
    expect(await writeIncomingPhotoDraft(storage.db, 'account', draft, existing)).toBe(true);
  });
  it('retries a crash after durable attachment without replacing the draft again', async () => {
    const storage = database(draft);
    expect(await writeIncomingPhotoDraft(storage.db, 'account', draft, undefined)).toBe(true);
    expect(storage.put).not.toHaveBeenCalled();
  });
  it('rejects failed persistence so the native source stays pending', async () => {
    const storage = database(undefined, true);
    await expect(writeIncomingPhotoDraft(storage.db, 'account', draft, undefined)).rejects.toThrow('disk full');
  });
});
