import { productCodeFromScan, type ScannedFormat } from './productCode';

export type ScanRect = { left: number; top: number; width: number; height: number };
export type ScanGeometry = { imageWidth: number; imageHeight: number; preview: ScanRect; webview: ScanRect };
export type NativeDetection = { rawValue?: string; format?: string; cornerPoints?: number[][] };
const FORMATS: Record<string, ScannedFormat> = { EAN_13: 'ean_13', EAN_8: 'ean_8', UPC_A: 'upc_a', UPC_E: 'upc_e', QR_CODE: 'qr_code' };

/** ML Kit corners are upright image pixels. CameraX uses FILL_CENTER behind the WebView. */
export function detectionCenter(detection: NativeDetection, geometry: ScanGeometry, viewport: { width: number; height: number }) {
  const points = detection.cornerPoints;
  if (!points || points.length !== 4 || points.some(point => point.length !== 2 || point.some(value => !Number.isFinite(value)))) return null;
  const { imageWidth, imageHeight, preview, webview } = geometry;
  if (![imageWidth, imageHeight, preview.width, preview.height, webview.width, webview.height, viewport.width, viewport.height].every(value => Number.isFinite(value) && value > 0) ||
    ![preview.left, preview.top, webview.left, webview.top].every(Number.isFinite)) return null;
  const xs = points.map(point => point[0]);
  const ys = points.map(point => point[1]);
  if (Math.max(...xs) <= Math.min(...xs) || Math.max(...ys) <= Math.min(...ys)) return null;
  const x = xs.reduce((sum, value) => sum + value, 0) / 4;
  const y = ys.reduce((sum, value) => sum + value, 0) / 4;
  const scale = Math.max(preview.width / imageWidth, preview.height / imageHeight);
  return {
    x: (preview.left + x * scale - (imageWidth * scale - preview.width) / 2 - webview.left) * viewport.width / webview.width,
    y: (preview.top + y * scale - (imageHeight * scale - preview.height) / 2 - webview.top) * viewport.height / webview.height
  };
}

export function selectTargetedProduct(detections: NativeDetection[], geometry: ScanGeometry,
  viewport: { width: number; height: number }, frame: ScanRect): string | null {
  const candidates: Array<{ code: string; distance: number }> = [];
  for (const detection of detections) {
    const center = detectionCenter(detection, geometry, viewport);
    if (!center || center.x < frame.left || center.x > frame.left + frame.width ||
      center.y < frame.top || center.y > frame.top + frame.height) continue;
    const code = detection.rawValue ? productCodeFromScan(detection.rawValue, FORMATS[detection.format ?? ''] ?? 'unknown') : null;
    if (!code) continue;
    candidates.push({ code, distance: (center.x - frame.left - frame.width / 2) ** 2 + (center.y - frame.top - frame.height / 2) ** 2 });
  }
  candidates.sort((a, b) => a.distance - b.distance || (a.code < b.code ? -1 : a.code > b.code ? 1 : 0));
  return candidates[0]?.code ?? null;
}
