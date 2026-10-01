import {Dumbbell, ArrowUpRight, LoaderCircle} from 'lucide-react';
import type {TrainingSummary, CoachingSettings} from '../types';
import {today} from '../lib/format';
import {displayWeight, unitsFor, weightLabel} from '../lib/units';
import {Button} from './ui/Button';
import {CardFeedback} from './ui/CardFeedback';
import {SkeletonBlock} from './ui/Skeleton';

export function TrainingSummaryCard({
  summaries,
  settings,
  timeZone,
  workoutConnected,
  warning,
  loading = false,
  error,
  onOpenSettings,
}: {
  summaries?: TrainingSummary[];
  settings?: CoachingSettings;
  timeZone?: string | null;
  workoutConnected?: boolean;
  warning?: string | null;
  loading?: boolean;
  error?: string | null;
  onOpenSettings?: () => void;
}) {
  const todayDate=today(timeZone??undefined);
  const isConnected = workoutConnected ?? Boolean(summaries && summaries.length > 0);
  const visible=(summaries??[])
    .filter(item=>item.localDate>=shift(todayDate,-7))
    .sort((left,right)=>{
      const leftUpcoming=left.localDate>=todayDate && left.status!=='completed';
      const rightUpcoming=right.localDate>=todayDate && right.status!=='completed';
      if (leftUpcoming !== rightUpcoming) return Number(rightUpcoming)-Number(leftUpcoming);
      const dateOrder = leftUpcoming
        ? left.localDate.localeCompare(right.localDate)
        : right.localDate.localeCompare(left.localDate);
      return dateOrder || left.workoutName.localeCompare(right.workoutName);
    })
    .slice(0,8);
  const unit=unitsFor(settings).weight;
  const feedbackMessage = error ?? warning;
  // Until the first answer arrives the connection itself is unknown, so say so rather than claim "not connected".
  const pending = loading && !visible.length && workoutConnected !== false;
  return <section className="panel training-summary" aria-labelledby="training-summary-title">
    <div className="training-summary-header">
      <div>
        <p className="eyebrow" id="training-summary-title">WORKOUTS</p>
        <h2>Recent and upcoming</h2>
      </div>
      <div className="training-icon-badge" aria-hidden="true">
        <Dumbbell size={22} />
      </div>
    </div>
    {feedbackMessage && <CardFeedback tone="warning" title="Workout sync needs attention" message={feedbackMessage} />}
    {loading && visible.length > 0 && <p className="source" role="status" aria-live="polite">Refreshing…</p>}
    {pending ? (
      <div className="training-empty-state training-pending" role="status" aria-live="polite" aria-busy="true">
        <div className="training-empty-icon" aria-hidden="true">
          <LoaderCircle size={22} className="spin" />
        </div>
        <div className="training-empty-content">
          <p className="training-empty-title">{isConnected ? 'Loading workouts' : 'Checking Workout connection'}</p>
          <p className="training-empty-description">
            {isConnected ? 'Fetching your recent and upcoming sessions.' : 'This usually takes a few seconds.'}
          </p>
          <div className="training-pending-lines" aria-hidden="true">
            <SkeletonBlock width="70%" height={10} />
            <SkeletonBlock width="45%" height={10} />
          </div>
        </div>
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
              ? 'Nothing scheduled or recorded in the past 7 days.'
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
          return <div className="training-summary-row" key={item.id || `${item.localDate}-${item.workoutName}-${index}`}>
            <div><strong>{item.workoutName}</strong><small>{item.localDate} · {completed?'Completed':scheduled?'Scheduled':'In progress'}</small></div>
            <div className="training-summary-metrics">
              {item.workingSetCount>0&&<span>{item.workingSetCount} sets</span>}
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
