export const NUTRITION_SHORTCUTS = [
  {
    action: 'log-food',
    name: 'Log food',
    shortName: 'Log food',
    description: 'Add food to your diary.',
    url: '/?nutritionAction=log-food',
  },
  {
    action: 'scan-barcode',
    name: 'Scan barcode',
    shortName: 'Scan barcode',
    description: 'Open the food barcode scanner.',
    url: '/?nutritionAction=scan-barcode',
  },
  {
    action: 'log-weight',
    name: 'Log weight',
    shortName: 'Log weight',
    description: 'Record your scale weight.',
    url: '/?nutritionAction=log-weight',
  },
] as const;

export type NutritionShortcutAction = typeof NUTRITION_SHORTCUTS[number]['action'];

const STORAGE_KEY = 'nourish-pending-shortcut-v1';
const PENDING_LIFETIME_MS = 30 * 60 * 1000;
const MAX_CLOCK_SKEW_MS = 2 * 60 * 1000;

interface ShortcutStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

interface PendingShortcut {
  version: 1;
  action: NutritionShortcutAction;
  capturedAt: number;
}

export function captureNutritionShortcut(
  href: string,
  storage: ShortcutStorage,
  now = Date.now(),
): { action: NutritionShortcutAction; cleanUrl: string } | null {
  let url: URL;
  try {
    url = new URL(href, 'https://nutrition.invalid');
  } catch {
    return null;
  }

  const values = url.searchParams.getAll('nutritionAction');
  if (values.length !== 1 || !isNutritionShortcutAction(values[0])) return null;
  const action = values[0];
  const pending: PendingShortcut = { version: 1, action, capturedAt: now };

  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(pending));
  } catch {
    // Keep the URL intact when the browser cannot retain the action.
    return null;
  }

  url.searchParams.delete('nutritionAction');
  return { action, cleanUrl: `${url.pathname}${url.search}${url.hash}` };
}

export function consumePendingNutritionShortcut(
  storage: ShortcutStorage,
  now = Date.now(),
): NutritionShortcutAction | null {
  let serialized: string | null;
  try {
    serialized = storage.getItem(STORAGE_KEY);
    if (serialized === null) return null;
    // Remove before dispatch so reloads cannot launch the same action twice.
    storage.removeItem(STORAGE_KEY);
  } catch {
    return null;
  }

  try {
    const pending = JSON.parse(serialized) as Partial<PendingShortcut>;
    if (pending.version !== 1 || !isNutritionShortcutAction(pending.action) ||
      typeof pending.capturedAt !== 'number' || !Number.isFinite(pending.capturedAt)) return null;
    const age = now - pending.capturedAt;
    if (age < -MAX_CLOCK_SKEW_MS || age > PENDING_LIFETIME_MS) return null;
    return pending.action;
  } catch {
    return null;
  }
}

export function consumeReadyNutritionShortcut(
  storage: ShortcutStorage,
  readiness: { authenticated: boolean; profileReady: boolean },
  now = Date.now(),
): NutritionShortcutAction | null {
  if (!readiness.authenticated || !readiness.profileReady) return null;
  return consumePendingNutritionShortcut(storage, now);
}

export function clearPendingNutritionShortcut(storage: ShortcutStorage): void {
  try {
    storage.removeItem(STORAGE_KEY);
  } catch {
    // The shortcut is not recoverable in this browser if its storage is unavailable.
  }
}

function isNutritionShortcutAction(value: unknown): value is NutritionShortcutAction {
  return NUTRITION_SHORTCUTS.some(shortcut => shortcut.action === value);
}
