import {Dumbbell, ArrowUpRight, LoaderCircle, Check} from 'lucide-react';
import type {TrainingSummary, CoachingSettings} from '../types';
import {today} from '../lib/format';
import {displayWeight, unitsFor, weightLabel} from '../lib/units';
import {Button} from './ui/Button';
import {CardFeedback} from './ui/CardFeedback';
import {SkeletonBlock} from './ui/Skeleton';

const UP_NEXT_LIMIT=3;

export function TrainingSummaryCard({
  summaries,
  settings,
  timeZone,
  syncedAt,
  workoutConnected,
  warning,
  loading = false,
  resolved = true,
  error,
  onOpenSettings,
  onRetry,
}: {
  summaries?: TrainingSummary[];
  settings?: CoachingSettings;
  timeZone?: string | null;
  syncedAt?: string | null;
  workoutConnected?: boolean;
  warning?: string | null;
  loading?: boolean;
  /** False until a live read has answered; the bootstrap warning is only the last stored outcome. */
  resolved?: boolean;
  error?: string | null;
  onOpenSettings?: () => void;
  onRetry?: () => void;
}) {
  const todayDate=today(timeZone??undefined);
  // Up-next days are the active program's remaining days this week, in program order; they lead
  // the list and are capped so recent training stays visible.
  const all=summaries??[];
  const isConnected = workoutConnected ?? all.length > 0;
  const inProgress=all.filter(item=>item.status==='in_progress');
  const upNext=all.filter(item=>item.status==='upcoming').slice(0,UP_NEXT_LIMIT);
  const recorded=all
    .filter(item=>item.status!=='upcoming'&&item.status!=='in_progress'&&item.localDate>=shift(todayDate,-7))
    .sort((left,right)=>right.localDate.localeCompare(left.localDate)||left.workoutName.localeCompare(right.workoutName))
    .slice(0,Math.max(0,8-inProgress.length-upNext.length));
  const visible=[...inProgress,...upNext,...recorded];
  const unit=unitsFor(settings).weight;
  const feedbackMessage = error ?? (resolved ? warning : null);
  // Until the first answer the connection itself is unknown, so say so rather than claim "not connected".
  // Once any answer is known (live, or a stored sync time), refreshes stay quiet instead of
  // swapping a settled "No workouts" for a spinner on every background read.
  const settled = resolved || Boolean(syncedAt) || visible.length > 0;
  const pending = !settled && workoutConnected !== false;
  // Render the status line only when it has something to say; reserving its height left a gap under the title.
  const showLastSynced = visible.length > 0 && Boolean(syncedAt) && Number.isFinite(Date.parse(syncedAt ?? ''));
  const hasSyncStatus = showLastSynced || (loading && settled);
  return <section className="panel training-summary" aria-labelledby="training-summary-title">
    <div className="training-summary-header">
      <div>
        <p className="eyebrow" id="training-summary-title">WORKOUTS</p>
        <h2>Recent and upcoming</h2>
      </div>
      <div className={`training-icon-badge ${loading && settled ? 'training-refreshing' : ''}`} aria-hidden="true">
        <Dumbbell size={22} />
      </div>
    </div>
    {feedbackMessage && <CardFeedback tone="warning" title="Workout sync needs attention" message={feedbackMessage} action={onRetry ? { label: 'Retry', onClick: onRetry } : undefined} />}
    {hasSyncStatus && <div className="training-sync-status">
      {visible.length > 0 && syncedAt && Number.isFinite(Date.parse(syncedAt)) ? (
        <p className="source">
          Last synced <time dateTime={syncedAt}>{new Date(syncedAt).toLocaleString(undefined, { timeZone: timeZone ?? undefined })}</time>
          {loading && settled && <span className="training-refreshing-tag" role="status" aria-live="polite"><LoaderCircle size={11} className="spin" aria-hidden="true" /> Refreshing…</span>}
        </p>
      ) : loading && settled ? (
        <p className="source" role="status" aria-live="polite"><LoaderCircle size={11} className="spin" aria-hidden="true" /> Refreshing…</p>
      ) : null}
    </div>}
    {pending ? (
      <div className="training-skeleton-list" role="status" aria-live="polite" aria-busy="true">
        <span className="sr-only">{isConnected ? 'Loading workouts' : 'Checking Workout connection'}</span>
        {[0, 1, 2].map(i => (
          <div key={i} className="training-summary-row training-row-skeleton" aria-hidden="true">
            <div className="training-row-main">
              <SkeletonBlock width={`${50 + i * 14}%`} height={16} />
              <div className="training-skeleton-sub">
                <SkeletonBlock width="68px" height={12} />
              </div>
            </div>
            <div className="training-skeleton-badge">
              <SkeletonBlock width="64px" height={22} radius={999} />
            </div>
          </div>
        ))}
      </div>
    ) : !visible.length ? (
      <div className="training-empty-state">
        <div className="training-empty-icon" aria-hidden="true">
          <Dumbbell size={22} />
        </div>
        <div className="training-empty-content">
          <p className="training-empty-title">
            {isConnected ? 'No workouts' : 'Workout not connected'}
          </p>
          <p className="training-empty-description">
            {isConnected
              ? 'Nothing up next or logged in the past 7 days.'
              : 'Connect Workout to see training here.'}
          </p>
          {!isConnected && onOpenSettings && (
            <p className="source">
              <Button presentation="plain" className="inline-link" onClick={onOpenSettings}>
                Connect Workout in Settings <ArrowUpRight size={13} aria-hidden="true" />
              </Button>
            </p>
          )}
        </div>
      </div>
    ) : (
      <div className="training-summary-list">
        {visible.map((item,index)=>{
          const completed=item.status==='completed' || Boolean(item.finishedAt);
          const scheduled=item.status==='scheduled' || !item.startedAt;
          const isUpcoming=item.status==='upcoming';
          const isInProgress=item.status==='in_progress';
          // A program day has no calendar date, so it shows no date rather than today's.
          const when=isUpcoming?'Up next':`${item.localDate} · ${completed?'Completed':scheduled?'Scheduled':'In progress'}`;
          return <div className={`training-summary-row ${isUpcoming?'training-row-upcoming':''} ${isInProgress?'training-row-in-progress':''} ${completed?'training-row-completed':''}`} key={item.id || `${item.localDate}-${item.workoutName}-${index}`}>
            <div className="training-row-main">
              <strong>{item.workoutName}</strong>
              <small className="training-row-when">
                {isUpcoming ? (
                  <span className="training-tag training-tag-upcoming">Up next</span>
                ) : isInProgress ? (
                  <span className="training-tag training-tag-in-progress">
                    <span className="training-pulse-dot" aria-hidden="true" />
                    In progress
                  </span>
                ) : completed ? (
                  <span className="training-row-status-group">
                    <span className="training-tag training-tag-completed">
                      <Check size={11} strokeWidth={2.5} aria-hidden="true" />
                      Completed
                    </span>
                    <span className="training-row-date">{item.localDate}</span>
                  </span>
                ) : (
                  <span>{when}</span>
                )}
              </small>
            </div>
            <div className="training-summary-metrics">
              {item.workingSetCount>0&&<span>{item.workingSetCount} {item.workingSetCount===1?'set':'sets'}</span>}
              {item.externalVolumeKg!=null&&<span>{displayWeight(item.externalVolumeKg,unit,0)} {weightLabel(unit)} external volume</span>}
              {item.systemVolumeKg!=null&&<span>{displayWeight(item.systemVolumeKg,unit,0)} {weightLabel(unit)} system volume</span>}
              {item.averageRpe!=null&&<span>Avg RPE {item.averageRpe.toFixed(1)}</span>}
            </div>
          </div>;
        })}
      </div>
    )}
  </section>;
}

function shift(date:string,days:number){
  const value=new Date(`${date}T12:00:00Z`);value.setUTCDate(value.getUTCDate()+days);
  return value.toISOString().slice(0,10);
}
