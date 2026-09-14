import {useEffect, useState} from 'react';
import {Button} from './ui/Button';
import {Modal} from './ui/Modal';
import {useGoogleHealth} from '../lib/googleHealth';
import {GoogleHealthDisclosure} from './GoogleHealthDisclosure';
import {Activity, CheckCircle2, AlertTriangle, RefreshCw, Unlink} from 'lucide-react';

export function GoogleHealthSettings() {
  const {state, loading, error: syncError, refresh, connect, disconnect} = useGoogleHealth();
  const [disclosureOpen, setDisclosureOpen] = useState(false);
  const [disconnectOpen, setDisconnectOpen] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [actionError, setActionError] = useState('');
  const [bannerNotice, setBannerNotice] = useState<{type: 'success' | 'error'; message: string} | null>(null);

  // Check URL parameters for OAuth redirect results
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const ghResult = params.get('google_health');
    const code = params.get('code');

    if (ghResult === 'connected') {
      setBannerNotice({
        type: 'success',
        message: 'Google Health connected successfully. Step synchronization is active.',
      });
      void refresh(true);
      const url = new URL(window.location.href);
      url.searchParams.delete('google_health');
      url.searchParams.delete('code');
      window.history.replaceState({}, '', url.pathname + (url.search ? url.search : ''));
    } else if (ghResult === 'error') {
      let msg = 'Google Health connection was not completed.';
      if (code === 'duplicate_account') {
        msg = 'This Google account is already linked to another NutritionApp account. Each Google account can only connect once.';
      } else if (code === 'session_mismatch' || code === 'session_expired') {
        msg = 'Your NutritionApp session changed during connection. Please sign in and try again.';
      } else if (code === 'access_denied') {
        msg = 'Access was denied in Google permissions.';
      } else if (code === 'invalid_state') {
        msg = 'Connection session expired. Please start the connection again.';
      }
      setBannerNotice({type: 'error', message: msg});
      const url = new URL(window.location.href);
      url.searchParams.delete('google_health');
      url.searchParams.delete('code');
      window.history.replaceState({}, '', url.pathname + (url.search ? url.search : ''));
    }
  }, [refresh]);

  const handleStartConnect = async () => {
    setConnecting(true);
    setActionError('');
    try {
      const {authUrl} = await connect();
      window.location.href = authUrl;
    } catch (ex) {
      setActionError((ex as Error).message || 'Failed to start Google Health connection');
      setConnecting(false);
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

      {bannerNotice && (
        <div
          className={bannerNotice.type === 'success' ? 'notice settings-banner-success' : 'error settings-banner-error'}
          role={bannerNotice.type === 'success' ? 'status' : 'alert'}
        >
          {bannerNotice.message}
        </div>
      )}

      {actionError && (
        <p className="error" role="alert">
          {actionError}
        </p>
      )}

      {syncError && (
        <p className="notice" role="status">
          {syncError}
        </p>
      )}

      {state.status === 'disconnected' && (
        <div className="integration-state disconnected">
          <p className="description">
            Sync daily step totals automatically from Google Health. Step counts are read-only and never affect your calories, expenditure, or coaching targets.
          </p>
          <div className="actions">
            <Button variant="primary" onClick={() => setDisclosureOpen(true)}>
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
            <Button variant="primary" onClick={() => setDisclosureOpen(true)}>
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

          {state.warningMessage && (
            <p className="source warning-text" role="status">
              {state.warningMessage}
            </p>
          )}

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

      <p className="source privacy-links">
        Data is encrypted with Google Cloud KMS and retained for a rolling 31-day window. Learn more in our{' '}
        <a href="/help/google-health" target="_blank" rel="noopener noreferrer">
          Google Health help and deletion policy
        </a>
        .
      </p>

      {/* Pre-connection disclosure modal */}
      <GoogleHealthDisclosure
        open={disclosureOpen}
        onClose={() => setDisclosureOpen(false)}
        onConfirm={handleStartConnect}
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
            Disconnecting will revoke NutritionApp&apos;s access and immediately delete all 31 days of imported step data from your account.
          </p>
          <div className="actions">
            <Button variant="tertiary" onClick={() => setDisconnectOpen(false)} disabled={disconnecting}>
              Keep connected
            </Button>
            <Button variant="destructive" onClick={() => void handleConfirmDisconnect()} disabled={disconnecting}>
              {disconnecting ? 'Disconnecting…' : 'Disconnect and delete steps'}
            </Button>
          </div>
        </div>
      </Modal>
    </section>
  );
}
