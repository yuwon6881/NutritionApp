import {useEffect, useState} from 'react';
import {Dumbbell, CheckCircle2, Unlink} from 'lucide-react';
import {api, ApiError} from '../lib/api';
import type {Nourish} from '../useNourish';
import {Button} from './ui/Button';
import {Modal} from './ui/Modal';
import {CardFeedback} from './ui/CardFeedback';

type Grant = {
  peer: string;
  status: 'active' | 'revoked';
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
    if (url.searchParams.get('error') === 'access_denied') {
      setBannerNotice({type: 'error', message: 'Workout connection was canceled.'});
      url.searchParams.delete('error');
      window.history.replaceState(window.history.state, '', url.pathname + url.search + url.hash);
    }
  }, []);

  const connect = () => {
    setBusy(true);
    setError('');
    // The backend performs the authorization-code exchange and stores only the encrypted
    // rotating refresh token. The PWA never receives either token.
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

  return (
    <section className="panel connected-apps-panel" aria-labelledby="connected-apps-title">
      <div className="section-heading">
        <div className="title-with-icon">
          <Dumbbell size={22} className="panel-icon" aria-hidden="true" />
          <h2 id="connected-apps-title">Connected Apps</h2>
        </div>
      </div>

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

      {loaded && !error && (!grant || grant.status !== 'active') && (
        <div className="integration-state disconnected">
          <p className="description">
            Connect Workout to display your scheduled, in-progress, and completed training sessions alongside your diary. Training data is read-only and never changes Nutrition targets.
          </p>
          <div className="actions">
            <Button variant="primary" disabled={busy} onClick={connect}>
              {busy ? 'Opening Fitness Account…' : 'Connect Workout'}
            </Button>
          </div>
        </div>
      )}

      {loaded && !error && grant?.status === 'active' && (
        <div className="integration-state connected">
          <div className="status-row">
            <div className="status-badge success">
              <CheckCircle2 size={16} aria-hidden="true" />
              <span>Connected</span>
            </div>
          </div>

          <div className="metadata-grid">
            <div className="metadata-item">
              <span className="label">Connected app</span>
              <span className="value">Workout</span>
            </div>
            <div className="metadata-item">
              <span className="label">Connected since</span>
              <span className="value">{formatTimestamp(grant.grantedAt)}</span>
            </div>
          </div>

          <div className="actions">
            <Button variant="destructive" onClick={() => setDisconnectOpen(true)} disabled={busy}>
              <Unlink size={15} aria-hidden="true" />
              <span>Disconnect</span>
            </Button>
          </div>
        </div>
      )}

      <p className="source connected-apps-retention-note">
        Nutrition reads Workout’s scheduled, in-progress, and completed training summaries. Workout never changes Nutrition targets. To enable the reverse direction, connect Nutrition from Workout.
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
          <div className="actions">
            <Button variant="tertiary" onClick={() => setDisconnectOpen(false)} disabled={disconnecting}>
              Keep connected
            </Button>
            <Button variant="destructive" onClick={() => void handleConfirmDisconnect()} disabled={disconnecting}>
              {disconnecting ? 'Disconnecting…' : 'Disconnect'}
            </Button>
          </div>
        </div>
      </Modal>
    </section>
  );
}
