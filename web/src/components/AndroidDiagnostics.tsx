import { useState } from 'react';
import { ChevronDown } from 'lucide-react';
import './AndroidDiagnostics.css';
import { Capacitor, registerPlugin } from '@capacitor/core';
import { countAccountLocalWork } from '../lib/local';
import { copyableDiagnostics, diagnosticLines, diagnosticTimestamp, recordedSync, type DeviceInfo, type DiagnosticLine } from '../lib/deviceDiagnostics';
import { readReminderCapabilities, reminderReadiness } from '../lib/push/reminderReadiness';
import { Button } from './ui/Button';
import { lastApkUpdate } from '../lib/apkUpdates';
import { CardFeedback } from './ui/CardFeedback';

const native = registerPlugin<{ getDeviceDiagnostics(): Promise<DeviceInfo> }>('NutritionDevice');
export function AndroidDiagnostics({ accountId }: { accountId: string }) {
  const [lines, setLines] = useState<DiagnosticLine[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  if (!Capacitor.isNativePlatform()) return null;
  const refresh = async () => {
    setBusy(true);
    setMessage('');
    try {
      const [info, work, reminders] = await Promise.all([
        native.getDeviceDiagnostics(), countAccountLocalWork(accountId), readReminderCapabilities()
      ]);
      setLines([...diagnosticLines(info, navigator.onLine, recordedSync(accountId)),
        ['Outbox changes', String(work.outboxMutations)], ['Body drafts', String(work.bodyDrafts)],
        ['Photo drafts', String(work.photoDrafts)], ['Food basket drafts', String(work.foodBasketDrafts)],
        ['Food scan drafts', String(work.scanDrafts)], ['Reminder readiness', reminderReadiness(reminders)],
        ['Last update check', diagnosticTimestamp(lastApkUpdate().lastSuccessfulCheck ? new Date(lastApkUpdate().lastSuccessfulCheck!).toISOString() : null)]]);
    } catch { setMessage('Device diagnostics could not be checked. Try Refresh.'); }
    finally { setBusy(false); }
  };
  return <details className="android-diagnostics" onToggle={event => { if (event.currentTarget.open && !lines.length && !busy) void refresh(); }}>
    <summary><ChevronDown size={18} aria-hidden="true"/>Android diagnostics</summary>
    <dl>{lines.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
    {message && <CardFeedback tone={message === 'Diagnostics copied.' ? 'success' : 'warning'} title="Diagnostics" message={message}/>}
    <div className="actions">
      <Button variant="secondary" disabled={busy} onClick={() => void refresh()}>Refresh</Button>
      <Button variant="secondary" disabled={busy || !lines.length} onClick={() => {
        void navigator.clipboard.writeText(copyableDiagnostics(lines)).then(() => setMessage('Diagnostics copied.'), () => setMessage('The clipboard is unavailable.'));
      }}>Copy diagnostics</Button>
    </div>
  </details>;
}
