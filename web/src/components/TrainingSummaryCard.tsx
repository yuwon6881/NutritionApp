import {Dumbbell, ArrowUpRight} from 'lucide-react';
import type {TrainingSummary, CoachingSettings} from '../types';
import {today} from '../lib/format';
import {displayWeight, unitsFor, weightLabel} from '../lib/units';
import {Button} from './ui/Button';

export function TrainingSummaryCard({
  summaries,
  settings,
  timeZone,
  onOpenSettings,
}: {
  summaries?: TrainingSummary[];
  settings?: CoachingSettings;
  timeZone?: string | null;
  onOpenSettings?: () => void;
}) {
  const todayDate=today(timeZone??undefined);
  const visible=(summaries??[])
    .filter(item=>item.localDate>=shift(todayDate,-7))
    .sort((left,right)=>{
      const leftUpcoming=left.localDate>=todayDate && left.status!=='completed';
      const rightUpcoming=right.localDate>=todayDate && right.status!=='completed';
      return Number(rightUpcoming)-Number(leftUpcoming)
        || left.localDate.localeCompare(right.localDate)
        || left.workoutName.localeCompare(right.workoutName);
    })
    .slice(0,8);
  const unit=unitsFor(settings).weight;
  return <section className="panel training-summary" aria-labelledby="training-summary-title">
    <div className="training-summary-header">
      <div>
        <p className="eyebrow" id="training-summary-title">TRAINING CONTEXT</p>
        <h2>Recent and upcoming workouts</h2>
      </div>
      <div className="training-icon-badge" aria-hidden="true">
        <Dumbbell size={22} />
      </div>
    </div>
    {!visible.length ? (
      <div className="training-empty-state">
        <div className="training-empty-icon" aria-hidden="true">
          <Dumbbell size={22} />
        </div>
        <div className="training-empty-content">
          <p className="training-empty-title">No connected workout schedule</p>
          <p className="training-empty-description">
            Workout training summaries provide training context alongside your diary. Nutrition targets remain unchanged.
          </p>
          {onOpenSettings && (
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
