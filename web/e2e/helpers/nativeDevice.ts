import type { Page } from '@playwright/test';

export async function mockNativeDevice(page: Page) {
  await page.addInitScript(() => {
    const state = {
      calls: [] as string[], copied: '', image: null as null | { id: string; mime: string; size: number; createdAt: number },
      reminder: { appPermission: true, channelExists: true, channelDisabled: true, soundConfigured: true,
        channelImportance: 4, appSettingsAvailable: true, channelSettingsAvailable: true },
      listeners: {} as Record<string, (data: unknown) => void>
    };
    const methods: Record<string, string[]> = {
      NutritionDevice: ['getReminderCapabilities', 'openReminderSettings', 'getDeviceDiagnostics', 'checkApkUpdate',
        'openApkRelease', 'getPendingShortcut', 'acknowledgeShortcut', 'getIncomingImage', 'readIncomingImage', 'discardIncomingImage'],
      App: ['getInfo', 'minimizeApp'], StatusBar: ['setStyle', 'setBackgroundColor', 'setOverlaysWebView'],
      Keyboard: [], PushNotifications: ['checkPermissions', 'createChannel', 'register', 'unregister'],
      Haptics: ['impact', 'notification', 'selectionChanged']
    };
    Object.assign(window, {
      __nativeDevice: state, androidBridge: { postMessage: () => undefined },
      Capacitor: {
        PluginHeaders: Object.entries(methods).map(([name, names]) => ({ name, methods: [
          ...names.map(method => ({ name: method, rtype: 'promise' })), { name: 'addListener', rtype: 'callback' }, { name: 'removeListener', rtype: 'promise' }
        ] })),
        nativeCallback: (plugin: string, method: string, options: { eventName: string }, callback: (data: unknown) => void) => {
          if (method === 'addListener') state.listeners[`${plugin}:${options.eventName}`] = callback;
          return `${plugin}:${options.eventName}`;
        },
        nativePromise: async (plugin: string, method: string, options?: { id?: string }) => {
          state.calls.push(`${plugin}.${method}`);
          if (method === 'getInfo') return { version: '1.0.1', build: '1234', id: 'com.nutritionapp.mobile' };
          if (method === 'checkPermissions') return { receive: 'granted' };
          if (method === 'getReminderCapabilities') return state.reminder;
          if (method === 'getPendingShortcut') return { shortcut: null };
          if (method === 'getIncomingImage') return { image: state.image };
          if (method === 'readIncomingImage') return { base64: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a1ioAAAAASUVORK5CYII=' };
          if (method === 'discardIncomingImage' && state.image?.id === options?.id) state.image = null;
          if (method === 'checkApkUpdate') return { status: 'available', versionName: '1.0.2', lastSuccessfulCheck: Date.now() };
          if (method === 'getDeviceDiagnostics') return { version: '1.0.1', build: 1234, channel: 'device-test', android: '16', sdk: 36,
            webview: '140.0', recoveryError: 'renderer_terminated' };
          return {};
        }
      }
    });
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async (value: string) => { state.copied = value; } } });
  });
}
