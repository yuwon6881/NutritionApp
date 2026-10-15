import { Capacitor } from '@capacitor/core';

export { BACK_TO_HOME_EVENT } from './appHistory';
export function isNativeApp() { return Capacitor.isNativePlatform(); }
export async function initializeNativeApp() {
  if (!isNativeApp()) return;
  await (await import('./nativeAppBridge')).initializeNativeApp();
}
