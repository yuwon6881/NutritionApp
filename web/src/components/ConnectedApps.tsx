import {useEffect, useState} from 'react';
import {Dumbbell, CheckCircle2, Unlink} from 'lucide-react';
import {api, ApiError} from '../lib/api';
import type {Nourish} from '../useNourish';
import {Button} from './ui/Button';
import {Modal} from './ui/Modal';
import {CardFeedback} from './ui/CardFeedback';

type Grant = {
  peer: string;
  status: 'active' | 'revoked' | 'reconnect_required';
  connectionState: 'connected' | 'temporary_unavailable' | 'upgrade_required' | 'reconnect_required' | 'disconnected';
  syncWarning: string | null;
  scopes: string[];
  grantedAt: string | null;
  revokedAt: string | null;
};

export function ConnectedApps({store}: {store?: Nourish}) {
  const [grant, setGrant] = useState<Grant>();
  const [busy, setBusy] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [disconnectOpen, setDisconnectOpen] = useState(false);
  const [error, setError] = useState('');
  const [bannerNotice, setBannerNotice] = useState<{type: 'success' | 'error'; message: string} | null>(null);
  const [loaded, setLoaded] = useState(false);

  const load = async () => {
    setLoaded(false);
    setError('');
    try {
      const rows = await api<Grant[]>('/integrations/connected');
      setGrant(rows.find(row => row.peer === 'workout'));
    } catch (ex) {
      setError(ex instanceof ApiError ? ex.message : 'Connected app status is unavailable.');
    } finally {
      setLoaded(true);
    }
  };

  useEffect(() => {
    void load();
    const url = new URL(window.location.href);
    const canceled = url.searchParams.get('central_error') === 'access_denied'
      || url.searchParams.get('error') === 'access_denied';
    const changedElsewhere = url.searchParams.get('central_error') === 'connection_changed';
    if (canceled || changedElsewhere) {
      setBannerNotice({
        type: 'error',
        message: changedElsewhere
          ? 'The Workout connection changed in another tab. Check its status and reconnect if needed.'
          : 'Workout connection was canceled.',
      });
      url.searchParams.delete('central_error');
      url.searchParams.delete('error');
      window.history.replaceState(window.history.state, '', url.pathname + url.search + url.hash);
    }
  }, []);

  const connect = () => {
    setBusy(true);
    setError('');
    // The backend performs the authorization-code exchange and stores the durable consent
    // reference. Access tokens remain server-side and short-lived.
    window.location.href = '/api/auth/central/connect';
  };

  const handleConfirmDisconnect = async () => {
    setDisconnecting(true);
    setError('');
    try {
      await api<void>('/integrations/connected/workout', undefined, 'DELETE');
      setGrant(undefined);
      setDisconnectOpen(false);
      setBannerNotice({
        type: 'success',
        message: 'Workout disconnected. Ephemeral workout summary data has been cleared.',
      });
      if (store) {
        await store.refresh();
      }
    } catch (ex) {
      setError(ex instanceof ApiError ? ex.message : 'Could not revoke Workout access.');
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

  const connectionState = grant?.connectionState ?? 'disconnected';
  const isConnected = connectionState === 'connected' || connectionState === 'temporary_unavailable';
  const needsReconnect = connectionState === 'upgrade_required' || connectionState === 'reconnect_required';

  const statusLabel = !loaded
    ? 'Checking…'
    : isConnected
      ? connectionState === 'connected' ? 'Connected' : 'Connected · sync delayed'
      : needsReconnect ? 'Reconnect required' : 'Not connected';
  const statusTone = !loaded ? 'neutral' : connectionState === 'connected' ? 'success' : isConnected || needsReconnect ? 'warning' : 'neutral';

  return (
    <article className="panel integration-card connected-apps-panel" aria-labelledby="connected-workout-title">
      <header className="integration-card-header">
        <span className="integration-logo" aria-hidden="true"><Dumbbell size={20} /></span>
        <div className="integration-card-title">
          <h3 id="connected-workout-title">Workout</h3>
          <p>Scheduled, in-progress, and completed training sessions.</p>
        </div>
        {!error && (
          <span className={`status-badge ${statusTone}`}>
            {isConnected && <CheckCircle2 size={14} aria-hidden="true" />}
            <span>{statusLabel}</span>
          </span>
        )}
      </header>

      {bannerNotice && (
        <CardFeedback
          tone={bannerNotice.type}
          title={bannerNotice.type === 'success' ? 'Workout updated' : 'Workout connection'}
          message={bannerNotice.message}
        />
      )}

      {error && (
        <CardFeedback
          title="Connected apps unavailable"
          message={error}
          action={{label: 'Retry', onClick: () => void load()}}
        />
      )}

      {!loaded && !error && (
        <p className="source" role="status" aria-busy="true">
          Loading connected app status…
        </p>
      )}

      {loaded && !error && !isConnected && (
        <div className="integration-state disconnected">
          <p className="description">
            {connectionState === 'upgrade_required'
              ? 'Reconnect once to upgrade this older Workout connection to permanent consent.'
              : connectionState === 'reconnect_required'
                ? 'Workout access has ended. Reconnect to restore training summaries.'
                : 'Show your training sessions alongside your diary. Training data is read-only.'}
          </p>
          <div className="actions">
            {grant && connectionState !== 'disconnected' && (
              <Button variant="destructive" onClick={() => setDisconnectOpen(true)} disabled={busy}>
                <Unlink size={15} aria-hidden="true" />
                <span>Disconnect</span>
              </Button>
            )}
            <Button variant="primary" disabled={busy} onClick={connect}>
              {busy ? 'Opening Fitness Account…' : connectionState === 'upgrade_required' ? 'Upgrade connection' : needsReconnect ? 'Reconnect Workout' : 'Connect Workout'}
            </Button>
          </div>
        </div>
      )}

      {loaded && !error && isConnected && grant && (
        <div className="integration-state connected">
          {grant.syncWarning && <p className="description" role="status">{grant.syncWarning}</p>}

          <dl className="metadata-grid">
            <div className="metadata-item">
              <dt className="label">Connected since</dt>
              <dd className="value">{formatTimestamp(grant.grantedAt)}</dd>
            </div>
            <div className="metadata-item">
              <dt className="label">Access</dt>
              <dd className="value">Read-only summaries</dd>
            </div>
          </dl>

          <div className="actions">
            <Button variant="destructive" onClick={() => setDisconnectOpen(true)} disabled={busy}>
              <Unlink size={15} aria-hidden="true" />
              <span>Disconnect</span>
            </Button>
          </div>
        </div>
      )}

      <p className="source integration-note">
        To share Nutrition goals and weight trends with Workout, connect Nutrition from Workout.
      </p>

      {/* Disconnect confirmation modal */}
      <Modal
        open={disconnectOpen}
        onClose={() => setDisconnectOpen(false)}
        title="Disconnect Workout?"
        description="Are you sure you want to disconnect Workout?"
        width="sm"
      >
        <div className="disconnect-dialog">
          <p>
            Disconnecting will revoke NutritionApp&apos;s access to Workout training summaries and clear ephemeral summary data.
          </p>
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
