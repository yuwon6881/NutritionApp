import { Capacitor } from '@capacitor/core';

let availability: Promise<boolean> | null = null;
export const loadBarcodePlugin = () => import('@capacitor-mlkit/barcode-scanning');
export function nativeBarcodeScannerAvailable(): Promise<boolean> {
  if (!Capacitor.isNativePlatform() || Capacitor.getPlatform() !== 'android') return Promise.resolve(false);
  availability ??= (async () => {
    try { return (await (await loadBarcodePlugin()).BarcodeScanner.isSupported()).supported; }
    catch { return false; }
  })();
  return availability;
}
