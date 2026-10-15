import { Capacitor, registerPlugin, type PluginListenerHandle } from '@capacitor/core';
import { captureNutritionShortcut, NATIVE_SHORTCUT_READY } from './nutritionShortcuts';

const LAST_IMPORTED = 'nutrition-native-shortcut-imported-v1';
type NativeShortcut = { id: string; action: string; atMs: number };
const native = registerPlugin<{
  getPendingShortcut(): Promise<{ shortcut: NativeShortcut | null }>;
  acknowledgeShortcut(options: { id: string }): Promise<void>;
  addListener(name: 'shortcutReady', callback: () => void): Promise<PluginListenerHandle>;
}>('NutritionDevice');

let pending: Promise<void> = Promise.resolve();
export function importNativeShortcut(): Promise<void> {
  pending = pending.catch(() => undefined).then(async () => {
    const { shortcut } = await native.getPendingShortcut();
    if (!shortcut) return;
    if (localStorage.getItem(LAST_IMPORTED) !== shortcut.id) {
      const captured = captureNutritionShortcut(`/?nutritionAction=${encodeURIComponent(shortcut.action)}`, localStorage, shortcut.atMs);
      if (!captured) return;
      localStorage.setItem(LAST_IMPORTED, shortcut.id);
    }
    await native.acknowledgeShortcut({ id: shortcut.id });
    window.dispatchEvent(new Event(NATIVE_SHORTCUT_READY));
  });
  return pending;
}

export async function initializeNativeShortcuts(): Promise<void> {
  if (!Capacitor.isNativePlatform() || !Capacitor.isPluginAvailable('NutritionDevice')) return;
  await native.addListener('shortcutReady', () => { void importNativeShortcut().catch(() => undefined); });
  await importNativeShortcut().catch(() => undefined);
}
