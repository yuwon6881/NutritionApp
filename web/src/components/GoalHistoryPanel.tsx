import type {CoachingSettings,Plan} from '../types';
import {buildGoalHistory,goalLabel,type GoalHistoryEntry} from '../lib/goalHistory';
import {displayWeight,unitsFor,weightLabel} from '../lib/units';

const statusText=(entry:GoalHistoryEntry)=>entry.status==='completed'?`Completed ${entry.endDate}`:entry.status==='changed'?`Changed ${entry.endDate}`:'In progress';

export function GoalHistoryPanel({plans,settings}:{plans:readonly Plan[];settings?:CoachingSettings}){
  const unit=unitsFor(settings).weight;
  const metric=settings?.weightGoalMetric??'scale';
  const entries=buildGoalHistory(plans,metric);
  const weight=(kg:number|null)=>kg==null?'—':`${displayWeight(kg,unit,1)} ${weightLabel(unit)}`;
  return <section className="panel">
    <div className="section-heading">
      <div>
        <h2>Goal history</h2>
        <p>When each goal started and ended, with your {metric==='trend'?'trend':'scale'} weight at the start and at the end.</p>
      </div>
    </div>
    {entries.length===0?<p>No goals yet.</p>:<dl className="plan-list">
      {entries.map(entry=><div key={`${entry.startDate}-${entry.goal}`}>
        <dt>{entry.startDate}</dt>
        <dd>{goalLabel(entry.goal)}<small className="goal-history-line">{statusText(entry)}</small><span className="goal-history-line">{weight(entry.startKg)} → {weight(entry.endKg)}</span></dd>
      </div>)}
    </dl>}
  </section>;
}
