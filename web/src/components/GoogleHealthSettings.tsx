import {useEffect, useState} from 'react';
import {Button} from './ui/Button';
import {Modal} from './ui/Modal';
import {recoverGoogleHealthWeightSync, setGoogleHealthWeightSync, useGoogleHealth} from '../lib/googleHealth';
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
  const [requestWeightSync, setRequestWeightSync] = useState(false);
  const [weightActionLoading, setWeightActionLoading] = useState(false);

  const openDisclosure = (requestWeight = requestWeightSync || state.weightSync.enabled) => {
    setRequestWeightSync(requestWeight);
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
        message: 'Google Health connected successfully. Initial step synchronization is starting separately.',
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
        msg = 'This Google account is already linked to another NutritionApp account. Each Google account can only connect once.';
      } else if (code === 'identity_change_requires_disconnect') {
        msg = 'This NutritionApp account is already linked to a different Google account. Disconnect it before connecting another account.';
      } else if (code === 'session_mismatch' || code === 'session_expired') {
        msg = 'Your NutritionApp session changed during connection. Please sign in and try again.';
      } else if (code === 'access_denied') {
        msg = 'Access was denied in Google permissions.';
      } else if (code === 'invalid_state') {
        msg = 'Connection session expired. Please start the connection again.';
      } else if (code === 'identity_resolution_failed') {
        msg = 'Google granted access, but its account identity could not be confirmed. Try again, and contact support if it continues.';
      } else if (code === 'token_exchange_failed') {
        msg = 'Google could not finish the authorization exchange. Check the configured redirect URI and try again.';
      } else if (code === 'missing_tokens') {
        msg = 'Google did not return the required authorization tokens. Remove this app from your Google account and reconnect.';
      } else if (code === 'encryption_failed') {
        msg = 'NutritionApp could not securely store the Google connection. Try again later.';
      } else if (code === 'missing_parameters') {
        msg = 'Google returned an incomplete authorization response. Please start the connection again.';
      } else if (code === 'invalid_scope') {
        msg = 'The Google Health permission is not enabled for this app. The app administrator must enable the requested scope before reconnecting.';
      } else if (code === 'provider_error') {
        msg = 'Google returned an unexpected authorization error. Please try again.';
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
      const {authUrl} = await connect(requestWeightSync);
      window.location.href = authUrl;
    } catch (ex) {
      setActionError((ex as Error).message || 'Failed to start Google Health connection');
      setConnecting(false);
    }
  };

  const handleWeightSyncChange = async (enabled: boolean) => {
    if (!state.weightSync.permissionGranted) {
      openDisclosure(true);
      return;
    }
    setWeightActionLoading(true);
    setActionError('');
    try {
      await setGoogleHealthWeightSync(enabled, state.weightSync.revision);
    } catch (ex) {
      setActionError((ex as Error).message || 'Could not update weight synchronization');
    } finally {
      setWeightActionLoading(false);
    }
  };

  const handleWeightRecovery = async () => {
    setWeightActionLoading(true);
    setActionError('');
    try {
      await recoverGoogleHealthWeightSync();
    } catch (ex) {
      setActionError((ex as Error).message || 'Could not recover weight synchronization');
    } finally {
      setWeightActionLoading(false);
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
        message: 'Google Health disconnected. All imported step counts have been deleted.',
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
    <section className="panel google-health-panel" aria-labelledby="google-health-title">
      <div className="section-heading">
        <div className="title-with-icon">
          <Activity size={22} className="panel-icon" aria-hidden="true" />
          <h2 id="google-health-title">Google Health</h2>
        </div>
      </div>

      {bannerNotice && <CardFeedback
        tone={bannerNotice.type}
        title={bannerNotice.type === 'success' ? 'Google Health connected' : 'Google Health connection failed'}
        message={bannerNotice.message}
        action={bannerNotice.type === 'error' ? {label: 'Try again', onClick: () => {setBannerNotice(null);openDisclosure();}} : undefined}
      />}

      {actionError && !disclosureOpen && <CardFeedback
        title="Google Health action failed"
        message={actionError}
        action={{label: 'Try again', onClick: () => {setActionError('');openDisclosure();}}}
      />}

      {syncError && <CardFeedback
        title="Step sync unavailable"
        message={syncError}
        action={{label: 'Retry sync', onClick: () => void refresh(true), disabled: loading}}
      />}

      {state.status === 'disconnected' && !loading && !syncError && (
        <div className="integration-state disconnected">
          <p className="description">
            Sync daily step totals automatically from Google Health. Step counts are read-only and never affect your calories, expenditure, or coaching targets.
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
          <div className="status-badge warning">
            <AlertTriangle size={16} aria-hidden="true" />
            <span>Reconnect required</span>
          </div>
          <p className="description">
            Google Health authorization has expired or was revoked. Reconnect to resume step synchronization.
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
          <div className="status-row">
            <div className="status-badge success">
              <CheckCircle2 size={16} aria-hidden="true" />
              <span>Connected</span>
            </div>
            {state.freshness === 'stale' && (
              <span className="freshness-badge stale" title="Step totals may not reflect the latest activity">
                Stale
              </span>
            )}
          </div>

          <div className="metadata-grid">
            <div className="metadata-item">
              <span className="label">Connected since</span>
              <span className="value">{formatTimestamp(state.connectedAt)}</span>
            </div>
            <div className="metadata-item">
              <span className="label">Last updated</span>
              <span className="value">{formatTimestamp(state.lastSyncedAt)}</span>
            </div>
          </div>

          {state.warningMessage && <CardFeedback
            tone="warning"
            title="Step sync needs attention"
            message={state.warningMessage}
            action={{label: 'Retry sync', onClick: () => void refresh(true), disabled: loading}}
          />}

          <div className="google-health-weight-sync">
            <Checkbox
              id="google-health-weight-sync-setting"
              role="switch"
              checked={state.weightSync.enabled}
              disabled={weightActionLoading}
              onChange={checked => void handleWeightSyncChange(checked)}
            >
              <span><strong>Sync weight to Google Health</strong><small>{state.weightSync.permissionGranted ? 'Newly accepted scale entries, edits, and deletions are processed automatically.' : 'Reconnect and grant the health metrics write permission to enable this.'}</small></span>
            </Checkbox>
            <p className="source">Existing entries are not uploaded. Uploads use recorded scale weight only, at noon in the profile time zone; Google copies remain after this setting is disabled.</p>
            {state.weightSync.pendingCount > 0 && <p className="source">{state.weightSync.pendingCount} weight {state.weightSync.pendingCount === 1 ? 'upload is' : 'uploads are'} pending.</p>}
            {state.weightSync.lastSuccessfulSyncAt && <p className="source">Last successful weight sync: {formatTimestamp(state.weightSync.lastSuccessfulSyncAt)}.</p>}
            {(state.weightSync.state === 'failed' || state.weightSync.state === 'unknown') && <CardFeedback
              tone={state.weightSync.state === 'unknown' ? 'warning' : 'error'}
              title={state.weightSync.state === 'unknown' ? 'Upload status unknown' : 'Weight sync needs attention'}
              message={state.weightSync.failureMessage ?? 'Google Health rejected a weight upload.'}
              action={{label: state.weightSync.state === 'unknown' ? 'Check Google copy and retry' : 'Retry weight sync', onClick: () => void handleWeightRecovery(), disabled: weightActionLoading}}
            />}
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

      <p className="source google-health-retention-note">
        Step data is encrypted with Google Cloud KMS and retained for a rolling 31-day window. Disconnecting revokes access and deletes imported steps, queue records, and mappings; already-uploaded Google weight copies remain.
      </p>

      {/* Pre-connection disclosure modal */}
      <GoogleHealthDisclosure
        open={disclosureOpen}
        onClose={() => setDisclosureOpen(false)}
        onConfirm={handleStartConnect}
        syncWeight={requestWeightSync}
        onSyncWeightChange={setRequestWeightSync}
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
            Disconnecting will revoke NutritionApp&apos;s access, delete all 31 days of imported step data, and remove local weight-sync mappings. Weight copies already uploaded to Google Health are not deleted.
          </p>
          <div className="actions">
            <Button variant="tertiary" onClick={() => setDisconnectOpen(false)} disabled={disconnecting}>
              Keep connected
            </Button>
            <Button variant="destructive" onClick={() => void handleConfirmDisconnect()} disabled={disconnecting}>
              {disconnecting ? 'Disconnecting…' : 'Disconnect and delete local data'}
            </Button>
          </div>
        </div>
      </Modal>
    </section>
  );
}
