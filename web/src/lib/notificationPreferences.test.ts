import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {
  clearRememberedNotificationPreferences,
  readRememberedNotificationPreferences,
  saveRememberedNotificationPreferences
} from './notificationPreferences';

describe('notificationPreferences helper', () => {
  const store = new Map<string, string>();

  beforeEach(() => {
    store.clear();
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => { store.set(k, v); },
      removeItem: (k: string) => { store.delete(k); }
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns null when no preferences are stored', () => {
    expect(readRememberedNotificationPreferences()).toBeNull();
    expect(readRememberedNotificationPreferences('alice')).toBeNull();
  });

  it('stores and restores boolean preferences', () => {
    saveRememberedNotificationPreferences({
      weeklyReminderEnabled: true,
      thisDeviceSubscribed: false
    });
    expect(readRememberedNotificationPreferences()).toEqual({
      weeklyReminderEnabled: true,
      thisDeviceSubscribed: false
    });
  });

  it('isolates preferences by account ID', () => {
    saveRememberedNotificationPreferences({
      weeklyReminderEnabled: true,
      thisDeviceSubscribed: true
    }, 'user-1');

    saveRememberedNotificationPreferences({
      weeklyReminderEnabled: false,
      thisDeviceSubscribed: false
    }, 'user-2');

    expect(readRememberedNotificationPreferences('user-1')).toEqual({
      weeklyReminderEnabled: true,
      thisDeviceSubscribed: true
    });
    expect(readRememberedNotificationPreferences('user-2')).toEqual({
      weeklyReminderEnabled: false,
      thisDeviceSubscribed: false
    });
    expect(readRememberedNotificationPreferences('user-3')).toBeNull();
  });

  it('stores the flags and the confirmed reminder time and drops everything else', () => {
    const extra = {
      weeklyReminderEnabled: true,
      thisDeviceSubscribed: true,
      weekday: 2,
      localTime: '09:00',
      timeZoneId: 'America/New_York',
      serverToken: 'secret'
    } as unknown as Parameters<typeof saveRememberedNotificationPreferences>[0];

    saveRememberedNotificationPreferences(extra, 'alice');
    const raw = store.get('nutrition-notification-preferences:alice');
    expect(raw).toBeDefined();
    const parsed = JSON.parse(raw!);
    expect(parsed).toEqual({
      weeklyReminderEnabled: true,
      thisDeviceSubscribed: true,
      localTime: '09:00'
    });
    expect(parsed).not.toHaveProperty('weekday');
    expect(parsed).not.toHaveProperty('serverToken');
  });

  it('keeps the remembered reminder time when a later save has none', () => {
    saveRememberedNotificationPreferences({weeklyReminderEnabled: true, thisDeviceSubscribed: true, localTime: '07:30'}, 'alice');
    saveRememberedNotificationPreferences({weeklyReminderEnabled: false, thisDeviceSubscribed: true}, 'alice');
    expect(readRememberedNotificationPreferences('alice')?.localTime).toBe('07:30');
  });

  it('rejects invalid or corrupted JSON gracefully', () => {
    store.set('nutrition-notification-preferences:alice', 'not-valid-json');
    expect(readRememberedNotificationPreferences('alice')).toBeNull();

    store.set('nutrition-notification-preferences:alice', JSON.stringify({weeklyReminderEnabled: 'not-a-bool', thisDeviceSubscribed: true}));
    expect(readRememberedNotificationPreferences('alice')).toBeNull();

    store.set('nutrition-notification-preferences:alice', JSON.stringify('a-primitive-string'));
    expect(readRememberedNotificationPreferences('alice')).toBeNull();
  });

  it('handles localStorage throwing errors without crashing', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => { throw new Error('SecurityError: Access denied'); },
      setItem: () => { throw new Error('QuotaExceededError'); },
      removeItem: () => { throw new Error('SecurityError'); }
    });

    expect(() => saveRememberedNotificationPreferences({weeklyReminderEnabled: true, thisDeviceSubscribed: false})).not.toThrow();
    expect(readRememberedNotificationPreferences()).toBeNull();
    expect(() => clearRememberedNotificationPreferences()).not.toThrow();
  });

  it('supports clearing preferences', () => {
    saveRememberedNotificationPreferences({weeklyReminderEnabled: true, thisDeviceSubscribed: true}, 'alice');
    expect(readRememberedNotificationPreferences('alice')).not.toBeNull();
    clearRememberedNotificationPreferences('alice');
    expect(readRememberedNotificationPreferences('alice')).toBeNull();
  });
});
