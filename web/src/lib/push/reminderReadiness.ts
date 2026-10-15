import { Capacitor, registerPlugin } from '@capacitor/core';

export type ReminderCapabilities = {
  appPermission: boolean;
  channelExists: boolean;
  channelDisabled: boolean;
  channelImportance?: number;
  soundConfigured: boolean;
  appSettingsAvailable: boolean;
  channelSettingsAvailable: boolean;
};
const native = registerPlugin<{
  getReminderCapabilities(): Promise<ReminderCapabilities>;
  openReminderSettings(options: { channel: boolean }): Promise<void>;
}>('NutritionDevice');

export function reminderReadiness(capabilities: ReminderCapabilities | null): 'blocked' | 'available but silent' | 'enabled' | 'could not check' {
  if (!capabilities) return 'could not check';
  if (!capabilities.appPermission || capabilities.channelDisabled) return 'blocked';
  if (!capabilities.channelExists || !capabilities.soundConfigured ||
    (capabilities.channelImportance !== undefined && capabilities.channelImportance >= 0 && capabilities.channelImportance < 3)) return 'available but silent';
  return 'enabled';
}

export async function readReminderCapabilities(): Promise<ReminderCapabilities | null> {
  if (!Capacitor.isNativePlatform() || !Capacitor.isPluginAvailable('NutritionDevice')) return null;
  try { return await native.getReminderCapabilities(); }
  catch { return null; }
}

export async function openReminderSettings(channel: boolean): Promise<void> {
  await native.openReminderSettings({ channel });
}
