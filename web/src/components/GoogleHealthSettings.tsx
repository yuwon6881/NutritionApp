import {useEffect, useRef, useState} from 'react';
import {Button} from './ui/Button';
import {Modal} from './ui/Modal';
import {
  formatGoogleHealthTimestamp as formatTimestamp,
  recoverGoogleHealthBundledSync,
  setGoogleHealthBundledSync,
  useGoogleHealth,
  type ConnectOptions,
} from '../lib/googleHealth';
import {describeConnectError, describeUploadFailure} from '../lib/googleHealthFailure';
import {takeConnectIntent} from '../lib/googleHealthConnectIntent';
import {GoogleHealthWeightImportSetting} from './GoogleHealthWeightImportSetting';
import {GoogleHealthDisclosure} from './GoogleHealthDisclosure';
import {GoogleHealthSyncOptions} from './GoogleHealthSyncOptions';
import {Activity, CheckCircle2, AlertTriangle, RefreshCw, Unlink} from 'lucide-react';
import {CardFeedback} from './ui/CardFeedback';
import {Checkbox} from './ui/Checkbox';
import {googleHealthRequiresBrowser,openGoogleHealthSettingsInBrowser} from '../lib/googleHealthBrowser';

interface BannerNotice {type: 'success' | 'error'; title: string; message: string}

function clearConsentQuery() {
  const url = new URL(window.location.href);
  url.searchParams.delete('google_health');
  url.searchParams.delete('code');
  window.history.replaceState(window.history.state, '', url.pathname + url.search + url.hash);
}

export function GoogleHealthSettings() {
  const {state, loading, error: syncError, refresh, connect, disconnect} = useGoogleHealth();
  const [disclosureOpen, setDisclosureOpen] = useState(false);
  const [disconnectOpen, setDisconnectOpen] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [actionError, setActionError] = useState('');
  const [bannerNotice, setBannerNotice] = useState<BannerNotice | null>(null);

  const [requestDataSync, setRequestDataSync] = useState(true);
  const [requestWeightImport, setRequestWeightImport] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const intentStarted = useRef(false);

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
  const syncFacts = [
    totalPending > 0 ? `${totalPending} pending` : '',
    latestSyncAt ? `Last sync: ${formatTimestamp(latestSyncAt)}` : '',
  ].filter(Boolean);

  const hasUnknown = state.weightSync.state === 'unknown' ||
    state.nutritionSync.state === 'unknown' ||
    state.bodyFatSync.state === 'unknown';

  const hasFailed = state.weightSync.state === 'failed' ||
    state.nutritionSync.state === 'failed' ||
    state.bodyFatSync.state === 'failed';

  const uploadFailure = describeUploadFailure([
    {label: 'Weight', status: state.weightSync},
    {label: 'Nutrition', status: state.nutritionSync},
    {label: 'Body fat', status: state.bodyFatSync},
  ]);

  const optionsSummary = `${bundledSyncEnabled ? 'Uploads on' : 'Uploads off'} · ${state.weightImport.enabled ? 'Import on' : 'Import off'}${totalPending > 0 ? ` · ${totalPending} pending` : ''}`;

  const statusLabel = loading && state.status === 'disconnected'
    ? 'Checking…'
    : state.status === 'connected' ? 'Connected' : state.status === 'reconnect_required' ? 'Reconnect required' : syncError ? 'Unavailable' : 'Not connected';
  const statusTone = state.status === 'connected' ? 'success' : state.status === 'reconnect_required' ? 'warning' : 'neutral';
  const browserHandoff = googleHealthRequiresBrowser();

  // Import is offered pre-checked to a new connection; a reconnect keeps the current choice so an
  // existing connection never starts importing without the user turning it on.
  const openDisclosure = (importWeight = state.status === 'disconnected' || state.weightImport.enabled) => {
    setRequestDataSync(bundledSyncEnabled || !allPermissionsGranted);
    setRequestWeightImport(importWeight);
    setDisclosureOpen(true);
  };

  // The consent callback reports its result once through the query string.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const result = params.get('google_health');
    if (result === 'connected') {
      setBannerNotice({type: 'success', title: 'Google Health connected', message: 'Steps now show on your Dashboard.'});
      setActionError('');
      void refresh(true);
      clearConsentQuery();
    } else if (result === 'error') {
      setBannerNotice({type: 'error', title: 'Google Health connection failed', message: describeConnectError(params.get('code'))});
      clearConsentQuery();
    }
  }, [refresh]);

  const startConnect = async (options: ConnectOptions) => {
    setConnecting(true);
    setActionError('');
    try {
      if (await openGoogleHealthSettingsInBrowser(options)) {
        setDisclosureOpen(false);
        setConnecting(false);
        return;
      }
      const {authUrl} = await connect(options);
      window.location.href = authUrl;
    } catch (ex) {
      setActionError((ex as Error).message || 'Failed to start Google Health connection');
      setConnecting(false);
    }
  };

  const handleStartConnect = () => void startConnect({
    syncWeight: requestDataSync,
    syncNutrition: requestDataSync,
    syncBodyFat: requestDataSync,
    importWeight: requestWeightImport,
  });

  // The Android app already showed the disclosure and opened this browser page for consent, so
  // continue to Google without asking again (sign-in may have happened in between).
  useEffect(() => {
    if (intentStarted.current || browserHandoff) return;
    intentStarted.current = true;
    const intent = takeConnectIntent();
    if (intent) void startConnect(intent);
  }, []);

  const handleBundledSyncChange = async (enabled: boolean) => {
    if (enabled && !allPermissionsGranted) {
      openDisclosure();
      setRequestDataSync(true);
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
      await refresh(true);
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
      setBannerNotice({type: 'success', title: 'Google Health disconnected', message: 'Local step data deleted.'});
    } catch (ex) {
      setActionError((ex as Error).message || 'Failed to disconnect Google Health');
    } finally {
      setDisconnecting(false);
    }
  };

  return (
    <article className="panel integration-card google-health-panel" aria-labelledby="google-health-title">
      <header className="integration-card-header">
        <span className="integration-logo" aria-hidden="true"><Activity size={20} /></span>
        <div className="integration-card-title">
          <h3 id="google-health-title">Google Health</h3>
          <p>Steps in; weight, food, and body fat out.</p>
        </div>
        <span className={`status-badge ${statusTone}`} role="status">
          {state.status === 'connected' ? <CheckCircle2 size={14} aria-hidden="true" /> : state.status === 'reconnect_required' ? <AlertTriangle size={14} aria-hidden="true" /> : null}
          <span>{statusLabel}</span>
        </span>
      </header>

      {/* The card's own Connect or Reconnect button is the retry, so the notice carries no action. */}
      {bannerNotice && (
        <CardFeedback
          tone={bannerNotice.type}
          title={bannerNotice.title}
          message={bannerNotice.message}
        />
      )}

      {connecting && !disclosureOpen && <p className="source integration-progress" role="status">Opening Google…</p>}

      {actionError && !disclosureOpen && (
        <CardFeedback
          title="Google Health action failed"
          message={actionError}
          action={{label: 'Try again', onClick: () => {setActionError(''); openDisclosure();}}}
        />
      )}

      {syncError && (
        <CardFeedback
          tone="warning"
          title="Step sync unavailable"
          message={syncError}
          action={{label: 'Retry sync', onClick: () => void refresh(true), disabled: loading}}
        />
      )}

      {state.status === 'disconnected' && !loading && !syncError && (
        <div className="integration-state disconnected">
          {browserHandoff && <p className="description">Finishes in your browser with the same Fitness Account.</p>}
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
            Connection expired. Reconnect to resume syncing.
          </p>
          <div className="actions">
            <Button variant="tertiary" onClick={() => setDisconnectOpen(true)}>
              Disconnect
            </Button>
            <Button variant="primary" onClick={() => openDisclosure()}>
              Reconnect Google Health
            </Button>
          </div>
        </div>
      )}

      {state.status === 'connected' && (
        <div className="integration-state connected">
          <p className="source integration-facts">
            Steps updated {formatTimestamp(state.lastSyncedAt)}
            {state.freshness === 'stale' && ' · may be behind'}
          </p>

          {state.warningMessage && !syncError && (
            <CardFeedback
              tone="warning"
              title="Step sync needs attention"
              message={state.warningMessage}
              action={{label: 'Retry sync', onClick: () => void refresh(true), disabled: loading}}
            />
          )}

          <GoogleHealthSyncOptions summary={optionsSummary} attention={hasFailed||hasUnknown||state.weightImport.state==='failed'}>
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
                  <strong>Upload to Google Health</strong>
                  <small>
                    {allPermissionsGranted ? 'Weight, food, and body fat.' : 'Reconnect to allow uploads.'}
                  </small>
                </span>
              </Checkbox>
              {syncFacts.length > 0 && <p className="source">{syncFacts.join(' · ')}</p>}
              {uploadFailure && (
                <CardFeedback
                  tone={uploadFailure.tone}
                  title={uploadFailure.title}
                  message={uploadFailure.message}
                  detail={uploadFailure.detail}
                  action={{
                    label: actionLoading && uploadFailure.action === 'retry' ? 'Retrying…' : uploadFailure.actionLabel,
                    onClick: uploadFailure.action === 'reconnect' ? () => openDisclosure() : () => void handleBundledRecovery(),
                    disabled: actionLoading,
                  }}
                />
              )}
            </div>

            <GoogleHealthWeightImportSetting
              status={state.weightImport}
              onRequestPermission={() => openDisclosure(true)}
              onRetry={() => void refresh(true)}
              retrying={loading}
            />
          </GoogleHealthSyncOptions>

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

      <GoogleHealthDisclosure
        open={disclosureOpen}
        onClose={() => setDisclosureOpen(false)}
        onConfirm={handleStartConnect}
        syncData={requestDataSync}
        onSyncDataChange={setRequestDataSync}
        importWeight={requestWeightImport}
        onImportWeightChange={setRequestWeightImport}
        loading={connecting}
        error={actionError}
      />

      <Modal
        open={disconnectOpen}
        onClose={() => setDisconnectOpen(false)}
        title="Disconnect Google Health?"
        description="Access is revoked and local step and sync data is deleted. Uploaded Google copies and imported weigh-ins stay."
        width="sm"
      >
        <div className="disconnect-dialog">
          <div className="modal-actions">
            <Button variant="tertiary" onClick={() => setDisconnectOpen(false)} disabled={disconnecting}>
              Keep connected
            </Button>
            <Button variant="destructive" onClick={() => void handleConfirmDisconnect()} disabled={disconnecting}>
              {disconnecting ? 'Disconnecting…' : 'Disconnect'}
            </Button>
          </div>
        </div>
      </Modal>
    </article>
  );
}
