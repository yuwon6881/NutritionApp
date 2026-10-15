import { useEffect, useState } from 'react';
import { App } from '@capacitor/app';
import { isNativeAndroid } from '../lib/push/nativeNotifications';
import { openReminderSettings, readReminderCapabilities, reminderReadiness, type ReminderCapabilities } from '../lib/push/reminderReadiness';
import { Button } from './ui/Button';
import { SettingRow } from './ui/SettingRow';

export function ReminderReadiness({ onRegister }: { onRegister: () => Promise<void> }) {
  const [capabilities, setCapabilities] = useState<ReminderCapabilities | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const refresh = () => readReminderCapabilities().then(setCapabilities);
  useEffect(() => {
    if (!isNativeAndroid()) return;
    let current = true;
    const read = () => { void readReminderCapabilities().then(value => { if (current) setCapabilities(value); }); };
    read();
    window.addEventListener('focus', read);
    const listener = App.addListener('appStateChange', ({ isActive }) => { if (isActive) read(); });
    return () => { current = false; window.removeEventListener('focus', read); void listener.then(handle => handle.remove()); };
  }, []);
  if (!isNativeAndroid()) return null;
  const state = reminderReadiness(capabilities);
  const channel = Boolean(capabilities?.appPermission && capabilities.channelExists);
  const canOpen = channel ? capabilities?.channelSettingsAvailable : capabilities?.appSettingsAvailable;
  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setError('');
    try { await action(); await refresh(); }
    catch (failure) { setError(failure instanceof Error ? failure.message : 'Reminder settings could not be opened.'); }
    finally { setBusy(false); }
  };
  return <SettingRow label="Android reminder readiness" description={<span role="status">
    {state === 'enabled' ? 'Enabled' : state === 'blocked' ? 'Blocked' : state === 'available but silent' ? 'Available but silent' : 'Could not check'}
    {capabilities?.channelDisabled ? '. Allow the reminder channel in Android settings.' : capabilities && !capabilities.channelExists ? '. Set up the reminder channel on this device.' : ''}
    {error && ` · ${error}`}
  </span>}>
    {capabilities && !capabilities.channelExists && capabilities.appPermission
      ? <Button variant="secondary" disabled={busy} onClick={() => void run(onRegister)}>Set up reminders</Button>
      : canOpen ? <Button variant="secondary" disabled={busy} onClick={() => void run(() => openReminderSettings(channel))}>Android settings</Button>
      : <Button variant="secondary" disabled={busy} onClick={() => void run(refresh)}>Check again</Button>}
  </SettingRow>;
}
