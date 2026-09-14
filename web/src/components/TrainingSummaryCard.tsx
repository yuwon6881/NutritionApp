import type {TrainingSummary, CoachingSettings} from '../types';
import {today} from '../lib/format';
import {displayWeight, unitsFor, weightLabel} from '../lib/units';

export function TrainingSummaryCard({summaries, settings, timeZone}:{summaries?:TrainingSummary[];settings?:CoachingSettings;timeZone?:string|null}){
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
    <div className="section-heading"><div><p className="eyebrow">TRAINING CONTEXT</p><h2 id="training-summary-title">Recent and upcoming workouts</h2></div><span className="tiny-label">INFORMATION ONLY</span></div>
    {!visible.length?<p className="empty">No connected workout schedule is available. Nutrition targets are unchanged.</p>:<div className="training-summary-list">{visible.map((item,index)=>{
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
    })}</div>}
  </section>;
}

function shift(date:string,days:number){
  const value=new Date(`${date}T12:00:00Z`);value.setUTCDate(value.getUTCDate()+days);
  return value.toISOString().slice(0,10);
}
