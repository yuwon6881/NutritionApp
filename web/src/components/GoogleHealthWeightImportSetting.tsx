import {useState} from 'react';
import {Checkbox} from './ui/Checkbox';
import {CardFeedback} from './ui/CardFeedback';
import {formatGoogleHealthTimestamp, setGoogleHealthWeightImport, type GoogleHealthWeightImportStatus} from '../lib/googleHealth';

// Weigh-ins written to Google Health by a smart scale fill days that have no weigh-in here yet.
export function GoogleHealthWeightImportSetting({status, onRequestPermission, onRetry, retrying}: {
  status: GoogleHealthWeightImportStatus;
  onRequestPermission: () => void;
  onRetry: () => void;
  retrying: boolean;
}) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const change = async (enabled: boolean) => {
    if (enabled && !status.permissionGranted) {
      onRequestPermission();
      return;
    }
    setSaving(true);
    setError('');
    try {
      await setGoogleHealthWeightImport(enabled, status.revision);
    } catch (ex) {
      setError((ex as Error).message || 'Could not update weigh-in import');
    } finally {
      setSaving(false);
    }
  };

  const hint = !status.permissionGranted
    ? 'Reconnect to allow reading weight from Google Health.'
    : status.enabled
      ? 'Fills days without a weigh-in, using the earliest reading. Turning this off stops new imports; weigh-ins already imported stay.'
      : 'Adds smart-scale weigh-ins from the last 31 days to days without one. Your own entries always win.';

  return (
    <div className="google-health-weight-import">
      <Checkbox
        id="google-health-weight-import"
        role="switch"
        aria-label="Import weigh-ins from Google Health"
        checked={status.enabled}
        disabled={saving}
        onChange={checked => void change(checked)}
      >
        <span>
          <strong>Import weigh-ins from Google Health</strong>
          <small>{hint}</small>
        </span>
      </Checkbox>
      {status.enabled && status.lastSuccessAt && (
        <p className="source">
          Last checked {formatGoogleHealthTimestamp(status.lastSuccessAt)}
          {status.lastImportedCount > 0 ? ` · ${status.lastImportedCount} ${status.lastImportedCount === 1 ? 'weigh-in' : 'weigh-ins'} added.` : ' · Nothing new.'}
        </p>
      )}
      {status.state === 'failed' && (
        <CardFeedback
          tone="warning"
          title="Weigh-in import needs attention"
          message={status.failureMessage || 'Google Health weigh-ins could not be imported.'}
          action={status.failureCode === 'permissions_missing'
            ? {label: 'Reconnect', onClick: onRequestPermission}
            : {label: 'Retry sync', onClick: onRetry, disabled: retrying}}
        />
      )}
      {error && <p className="error" role="alert">{error}</p>}
    </div>
  );
}
