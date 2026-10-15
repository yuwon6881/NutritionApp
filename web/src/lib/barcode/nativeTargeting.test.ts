import { describe, expect, it } from 'vitest';
import { detectionCenter, selectTargetedProduct, type ScanGeometry } from './nativeTargeting';

const geometry: ScanGeometry = {
  imageWidth: 1280, imageHeight: 720,
  preview: { left: 0, top: 72, width: 1080, height: 1920 },
  webview: { left: 0, top: 72, width: 1080, height: 1920 }
};
const viewport = { width: 360, height: 640 };
const frame = { left: 100, top: 250, width: 160, height: 140 };
const code = (x: number, y: number, rawValue = '4006381333931') => ({
  rawValue, format: 'EAN_13', cornerPoints: [[x - 5, y - 5], [x + 5, y - 5], [x + 5, y + 5], [x - 5, y + 5]]
});

describe('native barcode targeting', () => {
  it('accounts for density, fill-center crop and the WebView system-inset origin', () => {
    expect(detectionCenter(code(640, 360), geometry, viewport)).toEqual({ x: 180, y: 320 });
    const inset = { ...geometry, webview: { ...geometry.webview, top: 120, height: 1872 } };
    expect(detectionCenter(code(640, 360), inset, viewport)?.y).toBeCloseTo(912 * 640 / 1872, 6);
  });
  it('ignores nearby out-of-frame codes and chooses the nearest qualified center', () => {
    expect(selectTargetedProduct([code(0, 0), code(660, 360, '5901234123457'), code(640, 360)], geometry, viewport, frame)).toBe('4006381333931');
  });
  it('uses text as a deterministic tie-breaker', () => {
    expect(selectTargetedProduct([code(640, 360, '5901234123457'), code(640, 360)], geometry, viewport, frame)).toBe('4006381333931');
  });
  it('ignores missing, invalid or zero-area coordinates', () => {
    expect(selectTargetedProduct([{ rawValue: '4006381333931', format: 'EAN_13' }], geometry, viewport, frame)).toBeNull();
    expect(detectionCenter({ ...code(1, 1), cornerPoints: [[NaN, 3]] }, geometry, viewport)).toBeNull();
    expect(detectionCenter({ ...code(1, 1), cornerPoints: [[1, 1], [1, 1], [1, 1], [1, 1]] }, geometry, viewport)).toBeNull();
  });
  it('uses upright image dimensions for portrait and rotated landscape results', () => {
    const rotated = { ...geometry, imageWidth: 720, imageHeight: 1280 };
    expect(detectionCenter(code(360, 640), rotated, viewport)).toEqual({ x: 180, y: 320 });
    const landscape = { imageWidth: 1280, imageHeight: 720,
      preview: { left: 72, top: 0, width: 1920, height: 1080 }, webview: { left: 72, top: 0, width: 1920, height: 1080 } };
    expect(detectionCenter(code(640, 360), landscape, { width: 640, height: 360 })).toEqual({ x: 320, y: 180 });
  });
  it('preserves GS1 QR parsing and barcode checksum validation inside the frame', () => {
    expect(selectTargetedProduct([{ ...code(640, 360), rawValue: 'https://id.gs1.org/01/04006381333931', format: 'QR_CODE' }], geometry, viewport, frame)).toBe('4006381333931');
    expect(selectTargetedProduct([code(640, 360, '4006381333932')], geometry, viewport, frame)).toBeNull();
  });
});
