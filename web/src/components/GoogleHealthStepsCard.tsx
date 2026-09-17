import {Footprints, ArrowUpRight} from 'lucide-react';
import {number} from '../lib/format';
import {GoogleHealthDay, GoogleHealthFreshness, GoogleHealthStatus, getTodayStepCount} from '../lib/googleHealth';
import {Button} from './ui/Button';
import {CardFeedback} from './ui/CardFeedback';

interface GoogleHealthStepsCardProps {
  status: GoogleHealthStatus;
  freshness: GoogleHealthFreshness;
  lastSyncedAt: string | null;
  days: GoogleHealthDay[];
  todayDate: string;
  onOpenSettings?: () => void;
}

export function GoogleHealthStepsCard({
  status,
  freshness,
  lastSyncedAt,
  days,
  todayDate,
  onOpenSettings,
}: GoogleHealthStepsCardProps) {
  const count = getTodayStepCount(days, todayDate);

  const formatTime = (iso: string | null) => {
    if (!iso) return '';
    try {
      const d = new Date(iso);
      return d.toLocaleTimeString(undefined, {hour: 'numeric', minute: '2-digit'});
    } catch {
      return '';
    }
  };

  return (
    <article className="panel steps-panel" aria-labelledby="today-steps-title">
      <div className="steps-header">
        <div>
          <p className="eyebrow" id="today-steps-title">GOOGLE HEALTH STEPS</p>
          <h2>
            {count !== null ? (
              <>
                <span className="tabular-num">{number(count)}</span> <span className="unit">steps</span>
              </>
            ) : (
              <>
                <span>—</span> <span className="unit">steps</span>
              </>
            )}
          </h2>
        </div>
        <div className="steps-icon-badge" aria-hidden="true">
          <Footprints size={24} />
        </div>
      </div>

      <div className="steps-provenance">
        {status === 'disconnected' && (
          <p className="source">
            Not connected.{' '}
            {onOpenSettings && (
              <Button presentation="plain" className="inline-link" onClick={onOpenSettings}>
                Connect in Settings <ArrowUpRight size={13} aria-hidden="true" />
              </Button>
            )}
          </p>
        )}

        {status === 'reconnect_required' && (
          <CardFeedback
            tone="warning"
            title="Google Health needs reconnecting"
            message="Authorization has expired or was revoked, so new step totals are unavailable."
            action={onOpenSettings ? {label:'Open Settings',onClick:onOpenSettings} : undefined}
          />
        )}

        {status === 'connected' && count === null && (
          <p className="source">
            No step activity recorded for today yet.
          </p>
        )}

        {status === 'connected' && count !== null && (
          <p className="source">
            Synced from Google Health
            {lastSyncedAt && ` · Today at ${formatTime(lastSyncedAt)}`}
            {freshness === 'stale' && ' · Stale'}
          </p>
        )}
      </div>
    </article>
  );
}
