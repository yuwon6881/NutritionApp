import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { consumeReadyNutritionShortcut } from './nutritionShortcuts';
const native = vi.hoisted(() => ({ getPendingShortcut: vi.fn(), acknowledgeShortcut: vi.fn() }));
vi.mock('@capacitor/core', () => ({ Capacitor: {}, registerPlugin: () => native }));
import { importNativeShortcut } from './nativeShortcuts';
let values: Map<string, string>;
beforeEach(() => {
  vi.clearAllMocks();
  values = new Map();
  vi.stubGlobal('localStorage', { getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value), removeItem: (key: string) => values.delete(key) });
  vi.stubGlobal('window', { dispatchEvent: vi.fn() });
  native.getPendingShortcut.mockResolvedValue({ shortcut: { id: 'launch-1', action: 'scan-barcode', atMs: Date.now() } });
  native.acknowledgeShortcut.mockResolvedValue(undefined);
});
afterEach(() => vi.unstubAllGlobals());
describe('Android shortcut import', () => {
  it('retains cold and warm actions until authentication and profile readiness', async () => {
    await importNativeShortcut();
    expect(consumeReadyNutritionShortcut(localStorage, { authenticated: false, profileReady: false })).toBeNull();
    expect(consumeReadyNutritionShortcut(localStorage, { authenticated: true, profileReady: true })).toBe('scan-barcode');
    await importNativeShortcut();
    expect(consumeReadyNutritionShortcut(localStorage, { authenticated: true, profileReady: true })).toBeNull();
  });
  it('survives acknowledgement loss without dispatching the same shortcut again', async () => {
    native.acknowledgeShortcut.mockRejectedValueOnce(new Error('bridge lost'));
    await expect(importNativeShortcut()).rejects.toThrow('bridge lost');
    expect(consumeReadyNutritionShortcut(localStorage, { authenticated: true, profileReady: true })).toBe('scan-barcode');
    await importNativeShortcut();
    expect(consumeReadyNutritionShortcut(localStorage, { authenticated: true, profileReady: true })).toBeNull();
  });
  it('preserves the native occurrence time so an expired action cannot reopen a flow', async () => {
    native.getPendingShortcut.mockResolvedValue({ shortcut: { id: 'old', action: 'log-food', atMs: Date.now() - 1800001 } });
    await importNativeShortcut();
    expect(consumeReadyNutritionShortcut(localStorage, { authenticated: true, profileReady: true })).toBeNull();
  });
  it('drops a launch shortcut that becomes ready after the user already opened a dialog', async () => {
    // A cold server delays authentication; the user starts logging meanwhile, so the late shortcut must
    // not close that dialog, jump to the Dashboard and discard a photo taken in the meantime.
    await importNativeShortcut();
    expect(consumeReadyNutritionShortcut(localStorage, { authenticated: true, profileReady: true, workInProgress: true })).toBeNull();
    expect(consumeReadyNutritionShortcut(localStorage, { authenticated: true, profileReady: true })).toBeNull();
  });
  it('keeps the shortcut while not ready even if work is open, then applies it once ready and idle', async () => {
    await importNativeShortcut();
    expect(consumeReadyNutritionShortcut(localStorage, { authenticated: false, profileReady: true, workInProgress: true })).toBeNull();
    expect(consumeReadyNutritionShortcut(localStorage, { authenticated: true, profileReady: true })).toBe('scan-barcode');
  });
});
