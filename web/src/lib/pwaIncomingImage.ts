export const PWA_INCOMING_KEY = 'pending';
export const MAX_PWA_INCOMING_BYTES = 20 * 1024 * 1024;
export const MAX_PWA_INCOMING_AGE_MS = 24 * 60 * 60 * 1000;

export type PwaIncomingMime = 'image/jpeg' | 'image/png' | 'image/webp';

export interface PwaIncomingSummary {
  id: string;
  mime: PwaIncomingMime;
  size: number;
  createdAt: number;
  name: string;
}

export interface PwaIncomingRecord extends PwaIncomingSummary {
  bytes: ArrayBuffer;
}

export type SharedImageValidation =
  | { ok: true; mime: PwaIncomingMime; size: number; name: string; bytes: ArrayBuffer }
  | { ok: false; reason: 'empty' | 'too-large' | 'invalid' };

/** Inspects image file headers rather than trusting caller-supplied MIME metadata. */
export function detectSharedImageMime(bytes: Uint8Array): PwaIncomingMime | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'image/jpeg';
  }
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 &&
    bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a
  ) {
    return 'image/png';
  }
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
    bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50
  ) {
    return 'image/webp';
  }
  return null;
}

function defaultExtension(mime: PwaIncomingMime): string {
  if (mime === 'image/png') return 'png';
  if (mime === 'image/webp') return 'webp';
  return 'jpg';
}

export function validateSharedImageBytes(buffer: ArrayBuffer, rawName = ''): SharedImageValidation {
  if (buffer.byteLength === 0) return { ok: false, reason: 'empty' };
  if (buffer.byteLength > MAX_PWA_INCOMING_BYTES) return { ok: false, reason: 'too-large' };
  const mime = detectSharedImageMime(new Uint8Array(buffer));
  if (!mime) return { ok: false, reason: 'invalid' };
  const trimmed = rawName.trim().slice(0, 120);
  const name = trimmed || `shared-meal.${defaultExtension(mime)}`;
  return { ok: true, mime, size: buffer.byteLength, name, bytes: buffer };
}

/**
 * Whether a POST to the share target may store its photo. The worker never sees Sec-Fetch-Site,
 * but it does see Origin, which a page cannot strip with a no-referrer policy. An OS share is a
 * browser-started navigation, so it carries no Origin or an opaque "null" one; a form on another
 * site names that site. "null" stays accepted because rejecting it could block real shares, so a
 * sandboxed page can still reach the prompt — the person must still confirm the photo there.
 */
export function acceptsShareTargetOrigin(originHeader: string | null, ownOrigin: string): boolean {
  if (originHeader === null) return true;
  const origin = originHeader.trim();
  return origin === '' || origin === 'null' || origin === ownOrigin;
}

function requestPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed.'));
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error ?? new Error('IndexedDB transaction aborted.'));
    transaction.onerror = () => reject(transaction.error ?? new Error('IndexedDB transaction failed.'));
  });
}

function isRecord(value: unknown): value is PwaIncomingRecord {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<PwaIncomingRecord>;
  return typeof candidate.id === 'string' &&
    typeof candidate.mime === 'string' &&
    typeof candidate.size === 'number' &&
    typeof candidate.createdAt === 'number' &&
    typeof candidate.name === 'string' &&
    candidate.bytes instanceof ArrayBuffer;
}

export async function savePwaIncomingImage(
  db: IDBDatabase,
  input: { bytes: ArrayBuffer; name?: string; id?: string; createdAt?: number },
): Promise<PwaIncomingSummary> {
  const checked = validateSharedImageBytes(input.bytes, input.name);
  if (!checked.ok) {
    throw new Error(checked.reason === 'too-large' ? 'The shared image exceeds 20 MB.' : 'Unsupported image file.');
  }
  const record: PwaIncomingRecord = {
    id: input.id ?? crypto.randomUUID(),
    mime: checked.mime,
    size: checked.size,
    createdAt: input.createdAt ?? Date.now(),
    name: checked.name,
    bytes: checked.bytes,
  };
  const tx = db.transaction('pwa_incoming', 'readwrite');
  tx.objectStore('pwa_incoming').put(record, PWA_INCOMING_KEY);
  await transactionDone(tx);
  return { id: record.id, mime: record.mime, size: record.size, createdAt: record.createdAt, name: record.name };
}

export async function peekPwaIncomingImageFromDb(
  db: IDBDatabase,
  now = Date.now(),
): Promise<PwaIncomingSummary | null> {
  if (!db.objectStoreNames.contains('pwa_incoming')) return null;
  const readTx = db.transaction('pwa_incoming', 'readonly');
  const raw = await requestPromise(readTx.objectStore('pwa_incoming').get(PWA_INCOMING_KEY));
  if (!isRecord(raw)) return null;
  if (now - raw.createdAt > MAX_PWA_INCOMING_AGE_MS || raw.createdAt > now + 60_000) {
    await discardPwaIncomingImageFromDb(db, raw.id);
    return null;
  }
  return { id: raw.id, mime: raw.mime, size: raw.size, createdAt: raw.createdAt, name: raw.name };
}

export async function readPwaIncomingFileFromDb(
  db: IDBDatabase,
  id: string,
  now = Date.now(),
): Promise<File> {
  const tx = db.transaction('pwa_incoming', 'readonly');
  const raw = await requestPromise(tx.objectStore('pwa_incoming').get(PWA_INCOMING_KEY));
  if (!isRecord(raw) || raw.id !== id || now - raw.createdAt > MAX_PWA_INCOMING_AGE_MS) {
    throw new Error('The shared image is no longer on this device.');
  }
  return new File([raw.bytes], raw.name, { type: raw.mime });
}

export async function discardPwaIncomingImageFromDb(db: IDBDatabase, id?: string): Promise<void> {
  if (!db.objectStoreNames.contains('pwa_incoming')) return;
  const tx = db.transaction('pwa_incoming', 'readwrite');
  const store = tx.objectStore('pwa_incoming');
  if (id) {
    const existing = await requestPromise(store.get(PWA_INCOMING_KEY));
    if (!isRecord(existing) || existing.id !== id) return;
  }
  store.delete(PWA_INCOMING_KEY);
  await transactionDone(tx);
}
