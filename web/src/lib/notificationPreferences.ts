export interface RememberedNotificationPreferences {
  weeklyReminderEnabled: boolean;
  thisDeviceSubscribed: boolean;
  /** Last reminder time the server confirmed, so a remembered card never shows an invented one. */
  localTime?: string;
}

const STORAGE_KEY = 'nutrition-notification-preferences';
const key = (accountId?: string) => accountId ? `${STORAGE_KEY}:${accountId}` : STORAGE_KEY;

/**
 * Remember the last known notification preference toggles in localStorage.
 * Only stores boolean preference flags to prevent caching stale server metadata.
 */
export function saveRememberedNotificationPreferences(
  preferences: RememberedNotificationPreferences,
  accountId?: string
): void {
  try {
    const localTime = preferences.localTime ?? readRememberedNotificationPreferences(accountId)?.localTime;
    const payload = {
      weeklyReminderEnabled: Boolean(preferences.weeklyReminderEnabled),
      thisDeviceSubscribed: Boolean(preferences.thisDeviceSubscribed),
      ...(localTime ? { localTime } : {})
    };
    localStorage.setItem(key(accountId), JSON.stringify(payload));
  } catch {
    // Storage quota exceeded or disabled in private browsing
  }
}

/**
 * Restore remembered notification preference toggles.
 * Returns null if not stored or corrupted.
 */
export function readRememberedNotificationPreferences(
  accountId?: string
): RememberedNotificationPreferences | null {
  try {
    const raw = localStorage.getItem(key(accountId));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return null;
    const weeklyReminderEnabled = typeof parsed.weeklyReminderEnabled === 'boolean'
      ? parsed.weeklyReminderEnabled
      : typeof parsed.reminderEnabled === 'boolean'
        ? parsed.reminderEnabled
        : null;
    if (weeklyReminderEnabled === null || typeof parsed.thisDeviceSubscribed !== 'boolean') return null;
    return {
      weeklyReminderEnabled,
      thisDeviceSubscribed: parsed.thisDeviceSubscribed,
      ...(typeof parsed.localTime === 'string' && /^\d{2}:\d{2}$/.test(parsed.localTime) ? { localTime: parsed.localTime } : {})
    };
  } catch {
    return null;
  }
}

export function clearRememberedNotificationPreferences(accountId?: string): void {
  try {
    localStorage.removeItem(key(accountId));
  } catch {}
}
