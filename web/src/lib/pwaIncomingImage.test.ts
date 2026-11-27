import { describe, expect, it } from 'vitest';
import {
  acceptsShareTargetOrigin,
  detectSharedImageMime,
  discardPwaIncomingImageFromDb,
  MAX_PWA_INCOMING_AGE_MS,
  MAX_PWA_INCOMING_BYTES,
  peekPwaIncomingImageFromDb,
  PWA_INCOMING_KEY,
  readPwaIncomingFileFromDb,
  savePwaIncomingImage,
  validateSharedImageBytes,
} from './pwaIncomingImage';

const jpegHeader = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16]).buffer;
const pngHeader = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1]).buffer;
const webpHeader = new Uint8Array([0x52, 0x49, 0x46, 0x46, 20, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]).buffer;

function createFakeDb(initial?: unknown) {
  let stored = initial;
  const stores = new Set(['pwa_incoming']);
  const db = {
    objectStoreNames: { contains: (name: string) => stores.has(name) } as DOMStringList,
    transaction: () => {
      const tx = {
        oncomplete: null as (() => void) | null,
        onabort: null as (() => void) | null,
        onerror: null as (() => void) | null,
        error: null,
        objectStore: () => ({
          get: () => {
            const req = { result: stored, onsuccess: null as (() => void) | null, onerror: null };
            queueMicrotask(() => req.onsuccess?.());
            return req;
          },
          put: (value: unknown) => {
            stored = value;
            queueMicrotask(() => tx.oncomplete?.());
          },
          delete: () => {
            stored = undefined;
            queueMicrotask(() => tx.oncomplete?.());
          },
        }),
      };
      return tx;
    },
  } as unknown as IDBDatabase;
  return { db, getStored: () => stored, key: PWA_INCOMING_KEY };
}

describe('pwaIncomingImage', () => {
  it('detects JPEG, PNG, and WebP signatures and rejects unsupported files', () => {
    expect(detectSharedImageMime(new Uint8Array(jpegHeader))).toBe('image/jpeg');
    expect(detectSharedImageMime(new Uint8Array(pngHeader))).toBe('image/png');
    expect(detectSharedImageMime(new Uint8Array(webpHeader))).toBe('image/webp');
    expect(detectSharedImageMime(new Uint8Array([0x25, 0x50, 0x44, 0x46]))).toBeNull();

    expect(validateSharedImageBytes(new ArrayBuffer(0))).toEqual({ ok: false, reason: 'empty' });
    expect(validateSharedImageBytes(new ArrayBuffer(MAX_PWA_INCOMING_BYTES + 1))).toEqual({ ok: false, reason: 'too-large' });
    expect(validateSharedImageBytes(new Uint8Array([1, 2, 3, 4]).buffer)).toEqual({ ok: false, reason: 'invalid' });
    const valid = validateSharedImageBytes(pngHeader, '');
    expect(valid).toMatchObject({ ok: true, mime: 'image/png', name: 'shared-meal.png' });
  });

  it('saves, peeks, reads, discards, and expires records cleanly', async () => {
    const fake = createFakeDb();
    const summary = await savePwaIncomingImage(fake.db, {
      id: 'share-1',
      bytes: jpegHeader,
      name: 'lunch.jpg',
      createdAt: 1_000,
    });
    expect(summary).toEqual({
      id: 'share-1',
      mime: 'image/jpeg',
      size: jpegHeader.byteLength,
      createdAt: 1_000,
      name: 'lunch.jpg',
    });

    expect(await peekPwaIncomingImageFromDb(fake.db, 10_000)).toEqual(summary);
    const file = await readPwaIncomingFileFromDb(fake.db, 'share-1', 10_000);
    expect(file.name).toBe('lunch.jpg');
    expect(file.type).toBe('image/jpeg');
    expect(file.size).toBe(jpegHeader.byteLength);

    // Mismatched id does not discard the active pending photo.
    await discardPwaIncomingImageFromDb(fake.db, 'other');
    expect(await peekPwaIncomingImageFromDb(fake.db, 10_000)).toEqual(summary);

    await discardPwaIncomingImageFromDb(fake.db, 'share-1');
    expect(await peekPwaIncomingImageFromDb(fake.db, 10_000)).toBeNull();

    await savePwaIncomingImage(fake.db, { id: 'expired', bytes: pngHeader, createdAt: 1_000 });
    expect(await peekPwaIncomingImageFromDb(fake.db, 1_000 + MAX_PWA_INCOMING_AGE_MS + 1)).toBeNull();
    expect(fake.getStored()).toBeUndefined();
  });
});

describe('acceptsShareTargetOrigin', () => {
  const own = 'https://nutrition.example';
  it('accepts an OS share, which has no origin or an opaque one', () => {
    expect(acceptsShareTargetOrigin(null, own)).toBe(true);
    expect(acceptsShareTargetOrigin('', own)).toBe(true);
    expect(acceptsShareTargetOrigin('null', own)).toBe(true);
  });
  it('accepts a post from the app itself', () => {
    expect(acceptsShareTargetOrigin(own, own)).toBe(true);
  });
  it('rejects a form on another site, even a look-alike', () => {
    expect(acceptsShareTargetOrigin('https://evil.example', own)).toBe(false);
    expect(acceptsShareTargetOrigin('http://nutrition.example', own)).toBe(false);
    expect(acceptsShareTargetOrigin('https://nutrition.example.evil.example', own)).toBe(false);
  });
});
