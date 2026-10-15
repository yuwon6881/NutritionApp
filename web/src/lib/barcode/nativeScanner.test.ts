import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({
  listeners: new Map<string, (event: unknown) => void>(), active: undefined as ((event: { isActive: boolean }) => void) | undefined,
  scanner: { getScanCoordinateContract: vi.fn(), isSupported: vi.fn(), checkPermissions: vi.fn(), requestPermissions: vi.fn(),
    startScan: vi.fn(), stopScan: vi.fn(), enableTorch: vi.fn(), disableTorch: vi.fn(), isTorchAvailable: vi.fn(), addListener: vi.fn() }
}));
vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: () => true, getPlatform: () => 'android' } }));
vi.mock('@capacitor-mlkit/barcode-scanning', () => ({ BarcodeScanner: mocks.scanner,
  BarcodeFormat: {}, LensFacing: { Back: 'BACK' } }));
vi.mock('@capacitor/app', () => ({ App: { addListener: async (_name: string, callback: typeof mocks.active) => {
  mocks.active = callback;
  return { remove: async () => { mocks.active = undefined; } };
} } }));
import { startNativeScan, NATIVE_SCAN_CLASS } from './nativeScanner';

const classes = new Set<string>();
const bounds = { left: 0, top: 0, width: 100, height: 100 };
beforeEach(() => {
  vi.clearAllMocks();
  mocks.listeners.clear();
  classes.clear();
  mocks.scanner.getScanCoordinateContract.mockResolvedValue({ version: 1 });
  mocks.scanner.isSupported.mockResolvedValue({ supported: true });
  mocks.scanner.checkPermissions.mockResolvedValue({ camera: 'granted' });
  mocks.scanner.startScan.mockResolvedValue(undefined);
  mocks.scanner.stopScan.mockResolvedValue(undefined);
  mocks.scanner.disableTorch.mockResolvedValue(undefined);
  mocks.scanner.isTorchAvailable.mockResolvedValue({ available: true });
  mocks.scanner.addListener.mockImplementation(async (name: string, callback: (event: unknown) => void) => {
    mocks.listeners.set(name, callback);
    return { remove: async () => { mocks.listeners.delete(name); } };
  });
  vi.stubGlobal('window', { innerWidth: 100, innerHeight: 100 });
  vi.stubGlobal('document', { visibilityState: 'visible', addEventListener: vi.fn(), removeEventListener: vi.fn(),
    documentElement: { classList: { add: (name: string) => classes.add(name), remove: (name: string) => classes.delete(name) } } });
});
afterEach(() => vi.unstubAllGlobals());
const options = () => ({ onCode: vi.fn(), onError: vi.fn(), getFrame: () => bounds, onSuspend: vi.fn() });

describe('native scanner lifecycle', () => {
  it('stops on background, disables the torch and restarts only while still open', async () => {
    const callbacks = options();
    const scan = await startNativeScan(callbacks);
    expect(scan.kind).toBe('started');
    mocks.active?.({ isActive: false });
    await vi.waitFor(() => expect(mocks.scanner.stopScan).toHaveBeenCalledOnce());
    expect(classes.has(NATIVE_SCAN_CLASS)).toBe(false);
    expect(callbacks.onSuspend).toHaveBeenCalledOnce();
    mocks.active?.({ isActive: true });
    await vi.waitFor(() => expect(mocks.scanner.startScan).toHaveBeenCalledTimes(2));
    if (scan.kind === 'started') await scan.session.stop();
    expect(mocks.active).toBeUndefined();
    expect(mocks.scanner.disableTorch).toHaveBeenCalled();
  });
  it('ignores detections with no coordinate evidence', async () => {
    const callbacks = options();
    const scan = await startNativeScan(callbacks);
    mocks.listeners.get('barcodesScanned')?.({ barcodes: [{ rawValue: '4006381333931', format: 'EAN_13' }] });
    expect(callbacks.onCode).not.toHaveBeenCalled();
    if (scan.kind === 'started') await scan.session.stop();
  });
  it('restores the opaque page after failure and falls back on an older APK', async () => {
    mocks.scanner.startScan.mockRejectedValueOnce(new Error('camera'));
    expect((await startNativeScan(options())).kind).toBe('unavailable');
    expect(classes.has(NATIVE_SCAN_CLASS)).toBe(false);
    expect(mocks.scanner.disableTorch).toHaveBeenCalled();
    mocks.scanner.getScanCoordinateContract.mockRejectedValueOnce(new Error('UNIMPLEMENTED'));
    expect((await startNativeScan(options())).kind).toBe('unavailable');
  });
  it('does not reprompt after camera permission withdrawal on resume', async () => {
    const callbacks = options();
    await startNativeScan(callbacks);
    mocks.active?.({ isActive: false });
    await vi.waitFor(() => expect(mocks.scanner.stopScan).toHaveBeenCalled());
    mocks.scanner.checkPermissions.mockResolvedValue({ camera: 'denied' });
    mocks.active?.({ isActive: true });
    await vi.waitFor(() => expect(callbacks.onError).toHaveBeenCalled());
    expect(mocks.scanner.requestPermissions).not.toHaveBeenCalled();
    expect(classes.has(NATIVE_SCAN_CLASS)).toBe(false);
  });
});
