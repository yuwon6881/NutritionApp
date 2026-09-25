import {useEffect, useState} from 'react';
import {Button} from './ui/Button';
import {Modal} from './ui/Modal';
import {
  recoverGoogleHealthBundledSync,
  setGoogleHealthBundledSync,
  useGoogleHealth,
} from '../lib/googleHealth';
import {GoogleHealthDisclosure} from './GoogleHealthDisclosure';
import {Activity, CheckCircle2, AlertTriangle, RefreshCw, Unlink} from 'lucide-react';
import {CardFeedback} from './ui/CardFeedback';
import {Checkbox} from './ui/Checkbox';

export function GoogleHealthSettings() {
  const {state, loading, error: syncError, refresh, connect, disconnect} = useGoogleHealth();
  const [disclosureOpen, setDisclosureOpen] = useState(false);
  const [disconnectOpen, setDisconnectOpen] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [actionError, setActionError] = useState('');
  const [bannerNotice, setBannerNotice] = useState<{type: 'success' | 'error'; message: string} | null>(null);

  const [requestDataSync, setRequestDataSync] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);

  const allPermissionsGranted = state.weightSync.permissionGranted &&
    state.nutritionSync.permissionGranted &&
    state.bodyFatSync.permissionGranted;

  const bundledSyncEnabled = state.weightSync.enabled ||
    state.nutritionSync.enabled ||
    state.bodyFatSync.enabled;

  const totalPending = (state.weightSync.enabled ? state.weightSync.pendingCount : 0) +
    (state.nutritionSync.enabled ? state.nutritionSync.pendingCount : 0) +
    (state.bodyFatSync.enabled ? state.bodyFatSync.pendingCount : 0);

  const syncTimestamps = [
    state.weightSync.lastSuccessfulSyncAt,
    state.nutritionSync.lastSuccessfulSyncAt,
    state.bodyFatSync.lastSuccessfulSyncAt,
  ].filter((t): t is string => Boolean(t));
  const latestSyncAt = syncTimestamps.length > 0 ? [...syncTimestamps].sort().at(-1) : null;

  const hasUnknown = state.weightSync.state === 'unknown' ||
    state.nutritionSync.state === 'unknown' ||
    state.bodyFatSync.state === 'unknown';

  const hasFailed = state.weightSync.state === 'failed' ||
    state.nutritionSync.state === 'failed' ||
    state.bodyFatSync.state === 'failed';

  const failureMessage = state.weightSync.failureMessage ||
    state.nutritionSync.failureMessage ||
    state.bodyFatSync.failureMessage ||
    'Google Health rejected an upload.';

  const statusLabel = loading && state.status === 'disconnected'
    ? 'Checking…'
    : state.status === 'connected' ? 'Connected' : state.status === 'reconnect_required' ? 'Reconnect required' : 'Not connected';
  const statusTone = state.status === 'connected' ? 'success' : state.status === 'reconnect_required' ? 'warning' : 'neutral';

  const openDisclosure = () => {
    setRequestDataSync(bundledSyncEnabled || !allPermissionsGranted);
    setDisclosureOpen(true);
  };

  // Check URL parameters for OAuth redirect results
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const ghResult = params.get('google_health');
    const code = params.get('code');

    if (ghResult === 'connected') {
      setBannerNotice({
        type: 'success',
        message: 'Google Health connected successfully.',
      });
      setActionError('');
      void refresh(true);
      const url = new URL(window.location.href);
      url.searchParams.delete('google_health');
      url.searchParams.delete('code');
      window.history.replaceState(window.history.state, '', url.pathname + (url.search ? url.search : '') + url.hash);
    } else if (ghResult === 'error') {
      let msg = 'Google Health connection was not completed.';
      if (code === 'duplicate_account') {
        msg = 'This Google account is already linked to another NutritionApp account.';
      } else if (code === 'identity_change_requires_disconnect') {
        msg = 'Disconnect the current Google account before connecting a different one.';
      } else if (code === 'session_mismatch' || code === 'session_expired') {
        msg = 'Session expired during connection. Please sign in and try again.';
      } else if (code === 'access_denied') {
        msg = 'Access was denied in Google permissions.';
      } else if (code === 'invalid_state') {
        msg = 'Connection session expired. Please try again.';
      } else if (code === 'identity_resolution_failed') {
        msg = 'Google account identity could not be confirmed. Try again.';
      } else if (code === 'token_exchange_failed') {
        msg = 'Could not complete authorization exchange with Google.';
      } else if (code === 'missing_tokens') {
        msg = 'Required authorization tokens were missing. Please reconnect.';
      } else if (code === 'encryption_failed') {
        msg = 'Could not securely store the Google connection. Try again later.';
      } else if (code === 'missing_parameters') {
        msg = 'Google returned an incomplete response. Please try again.';
      } else if (code === 'invalid_scope') {
        msg = 'Requested Google Health permissions are not enabled for this app.';
      } else if (code === 'provider_error') {
        msg = 'Google returned an unexpected authorization error.';
      }
      setBannerNotice({type: 'error', message: msg});
      const url = new URL(window.location.href);
      url.searchParams.delete('google_health');
      url.searchParams.delete('code');
      window.history.replaceState(window.history.state, '', url.pathname + (url.search ? url.search : '') + url.hash);
    }
  }, [refresh]);

  const handleStartConnect = async () => {
    setConnecting(true);
    setActionError('');
    try {
      const {authUrl} = await connect({
        syncWeight: requestDataSync,
        syncNutrition: requestDataSync,
        syncBodyFat: requestDataSync,
      });
      window.location.href = authUrl;
    } catch (ex) {
      setActionError((ex as Error).message || 'Failed to start Google Health connection');
      setConnecting(false);
    }
  };

  const handleBundledSyncChange = async (enabled: boolean) => {
    if (enabled && !allPermissionsGranted) {
      setRequestDataSync(true);
      setDisclosureOpen(true);
      return;
    }
    setActionLoading(true);
    setActionError('');
    try {
      await setGoogleHealthBundledSync(enabled);
    } catch (ex) {
      setActionError((ex as Error).message || 'Could not update data synchronization');
    } finally {
      setActionLoading(false);
    }
  };

  const handleBundledRecovery = async () => {
    setActionLoading(true);
    setActionError('');
    try {
      await recoverGoogleHealthBundledSync();
    } catch (ex) {
      setActionError((ex as Error).message || 'Could not recover data synchronization');
    } finally {
      setActionLoading(false);
    }
  };

  const handleConfirmDisconnect = async () => {
    setDisconnecting(true);
    setActionError('');
    try {
      await disconnect();
      setDisconnectOpen(false);
      setBannerNotice({
        type: 'success',
        message: 'Google Health disconnected. Local step data deleted.',
      });
    } catch (ex) {
      setActionError((ex as Error).message || 'Failed to disconnect Google Health');
    } finally {
      setDisconnecting(false);
    }
  };

  const formatTimestamp = (iso: string | null) => {
    if (!iso) return 'Never';
    try {
      const d = new Date(iso);
      return d.toLocaleString(undefined, {
        dateStyle: 'medium',
        timeStyle: 'short',
      });
    } catch {
      return iso;
    }
  };

  return (
    <article className="panel integration-card google-health-panel" aria-labelledby="google-health-title">
      <header className="integration-card-header">
        <span className="integration-logo" aria-hidden="true"><Activity size={20} /></span>
        <div className="integration-card-title">
          <h3 id="google-health-title">Google Health</h3>
          <p>Steps in; weight, nutrition, and body fat out when sync is on.</p>
        </div>
        <span className={`status-badge ${statusTone}`} role="status">
          {state.status === 'connected' ? <CheckCircle2 size={14} aria-hidden="true" /> : state.status === 'reconnect_required' ? <AlertTriangle size={14} aria-hidden="true" /> : null}
          <span>{statusLabel}</span>
        </span>
      </header>

      {bannerNotice && (
        <CardFeedback
          tone={bannerNotice.type}
          title={bannerNotice.type === 'success' ? 'Google Health connected' : 'Google Health connection failed'}
          message={bannerNotice.message}
          action={bannerNotice.type === 'error' ? {label: 'Try again', onClick: () => {setBannerNotice(null); openDisclosure();}} : undefined}
        />
      )}

      {actionError && !disclosureOpen && (
        <CardFeedback
          title="Google Health action failed"
          message={actionError}
          action={{label: 'Try again', onClick: () => {setActionError(''); openDisclosure();}}}
        />
      )}

      {syncError && (
        <CardFeedback
          title="Step sync unavailable"
          message={syncError}
          action={{label: 'Retry sync', onClick: () => void refresh(true), disabled: loading}}
        />
      )}

      {state.status === 'disconnected' && !loading && !syncError && (
        <div className="integration-state disconnected">
          <p className="description">
            Show your daily steps beside your diary and, if you choose, send new weight, nutrition, and body fat entries to Google Health.
          </p>
          <div className="actions">
            <Button variant="primary" onClick={() => openDisclosure()}>
              Connect Google Health
            </Button>
          </div>
        </div>
      )}

      {state.status === 'reconnect_required' && (
        <div className="integration-state reconnect-required">
          <p className="description">
            Google Health connection expired. Reconnect to resume syncing.
          </p>
          <div className="actions">
            <Button variant="primary" onClick={() => openDisclosure()}>
              Reconnect Google Health
            </Button>
            <Button variant="tertiary" onClick={() => setDisconnectOpen(true)}>
              Disconnect
            </Button>
          </div>
        </div>
      )}

      {state.status === 'connected' && (
        <div className="integration-state connected">
          {state.freshness === 'stale' && (
            <p className="source freshness-note">Step totals may not reflect your latest activity yet.</p>
          )}

          <dl className="metadata-grid">
            <div className="metadata-item">
              <dt className="label">Connected since</dt>
              <dd className="value">{formatTimestamp(state.connectedAt)}</dd>
            </div>
            <div className="metadata-item">
              <dt className="label">Steps updated</dt>
              <dd className="value">{formatTimestamp(state.lastSyncedAt)}</dd>
            </div>
          </dl>

          {state.warningMessage && (
            <CardFeedback
              tone="warning"
              title="Step sync needs attention"
              message={state.warningMessage}
              action={{label: 'Retry sync', onClick: () => void refresh(true), disabled: loading}}
            />
          )}

          {/* Bundled Health Data Sync Stream */}
          <div className="google-health-weight-sync">
            <Checkbox
              id="google-health-sync-setting"
              role="switch"
              aria-label="Sync health & nutrition data"
              checked={bundledSyncEnabled}
              disabled={actionLoading}
              onChange={checked => void handleBundledSyncChange(checked)}
            >
              <span>
                <strong>Sync health & nutrition data</strong>
                <small>
                  {allPermissionsGranted
                    ? 'Syncs weight, nutrition, and body fat.'
                    : 'Reconnect to grant sync permissions.'}
                </small>
              </span>
            </Checkbox>
            {totalPending > 0 && (
              <p className="source">{totalPending} {totalPending === 1 ? 'upload' : 'uploads'} pending.</p>
            )}
            {latestSyncAt && (
              <p className="source">Last sync: {formatTimestamp(latestSyncAt)}.</p>
            )}
            {(hasFailed || hasUnknown) && (
              <CardFeedback
                tone={hasUnknown ? 'warning' : 'error'}
                title={hasUnknown ? 'Upload status unknown' : 'Sync needs attention'}
                message={failureMessage}
                action={{
                  label: hasUnknown ? 'Check Google copy and retry' : 'Retry sync',
                  onClick: () => void handleBundledRecovery(),
                  disabled: actionLoading,
                }}
              />
            )}
          </div>

          <div className="actions">
            <Button variant="tertiary" onClick={() => void refresh(true)} disabled={loading}>
              <RefreshCw size={15} className={loading ? 'spin' : ''} aria-hidden="true" />
              <span>{loading ? 'Updating…' : 'Sync now'}</span>
            </Button>
            <Button variant="destructive" onClick={() => setDisconnectOpen(true)}>
              <Unlink size={15} aria-hidden="true" />
              <span>Disconnect</span>
            </Button>
          </div>
        </div>
      )}

      <p className="source integration-note">
        Steps are retained for 31 days. Disconnecting revokes access and deletes local sync data; Google copies remain.
      </p>

      {/* Pre-connection disclosure modal */}
      <GoogleHealthDisclosure
        open={disclosureOpen}
        onClose={() => setDisclosureOpen(false)}
        onConfirm={handleStartConnect}
        syncData={requestDataSync}
        onSyncDataChange={setRequestDataSync}
        loading={connecting}
        error={actionError}
      />

      {/* Disconnect confirmation modal */}
      <Modal
        open={disconnectOpen}
        onClose={() => setDisconnectOpen(false)}
        title="Disconnect Google Health?"
        description="Are you sure you want to disconnect Google Health?"
        width="sm"
      >
        <div className="disconnect-dialog">
          <p>
            Disconnecting revokes access and deletes local step and sync data. Uploaded Google copies remain.
          </p>
          <div className="modal-actions">
            <Button variant="tertiary" onClick={() => setDisconnectOpen(false)} disabled={disconnecting}>
              Keep connected
            </Button>
            <Button variant="destructive" onClick={() => void handleConfirmDisconnect()} disabled={disconnecting}>
              {disconnecting ? 'Disconnecting…' : 'Disconnect and delete local data'}
            </Button>
          </div>
        </div>
      </Modal>
    </article>
  );
}
