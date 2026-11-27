import type { Page } from '@playwright/test';

export async function mockNativeDevice(page: Page) {
  await page.addInitScript(() => {
    const listenerSets = new Map<string, Map<string, (data: unknown) => void>>();
    let nextCallbackId = 1;
    const state = {
      calls: [] as string[], image: null as null | { id: string; mime: string; size: number; createdAt: number },
      reminder: { appPermission: true, channelExists: true, channelDisabled: true, soundConfigured: true,
        channelImportance: 4, appSettingsAvailable: true, channelSettingsAvailable: true },
      listeners: {} as Record<string, (data: unknown) => void>
    };
    const methods: Record<string, string[]> = {
      NutritionDevice: ['getReminderCapabilities', 'openReminderSettings', 'getPendingShortcut', 'acknowledgeShortcut', 'getIncomingImage', 'readIncomingImage', 'discardIncomingImage', 'syncPendingMutations', 'readSyncedMutations', 'retireSyncedMutations', 'clearPendingMutations', 'updateWidgetSummary', 'clearWidgetSummary'],
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
        nativeCallback: (plugin: string, method: string, options: { eventName: string; callbackId?: string }, callback: (data: unknown) => void) => {
          const key = `${plugin}:${options.eventName}`;
          const set = listenerSets.get(key) ?? new Map<string, (data: unknown) => void>();
          listenerSets.set(key, set);
          const id = `${key}:${nextCallbackId++}`;
          if (method === 'addListener') {
            set.set(id, callback);
            state.listeners[key] = (data: unknown) => { for (const fn of set.values()) fn(data); };
          }
          return id;
        },
        nativePromise: async (plugin: string, method: string, options?: { id?: string; eventName?: string; callbackId?: string }) => {
          state.calls.push(`${plugin}.${method}`);
          if (method === 'removeListener' && options?.eventName && options?.callbackId) {
            listenerSets.get(`${plugin}:${options.eventName}`)?.delete(options.callbackId);
            return {};
          }
          if (method === 'getInfo') return { version: '1.0.1', build: '1234', id: 'com.nutritionapp.mobile' };
          if (method === 'checkPermissions') return { receive: 'granted' };
          if (method === 'getReminderCapabilities') return state.reminder;
          if (method === 'getPendingShortcut') return { shortcut: null };
          if (method === 'getIncomingImage') return { image: state.image };
          if (method === 'readIncomingImage') return { base64: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=' };
          if (method === 'discardIncomingImage' && state.image?.id === options?.id) state.image = null;
          if (method === 'readSyncedMutations') return { outcomes: [] };
          return {};
        }
      }
    });
  });
}
