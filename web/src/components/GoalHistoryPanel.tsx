import {ArrowRight,Calendar} from 'lucide-react';
import type {CoachingSettings,Plan} from '../types';
import {buildGoalHistory,goalLabel,type GoalHistoryEntry} from '../lib/goalHistory';
import {displayWeight,unitsFor,weightLabel} from '../lib/units';

const statusText=(entry:GoalHistoryEntry)=>entry.status==='completed'?'Completed':entry.status==='changed'?'Changed':'In progress';
const goalCategory=(goal:string)=>goal==='lose'?'DEFICIT':goal==='gain'?'SURPLUS':'MAINTENANCE';

export function GoalHistoryPanel({plans,settings}:{plans:readonly Plan[];settings?:CoachingSettings}){
  const unit=unitsFor(settings).weight;
  const metric=settings?.weightGoalMetric??'scale';
  const entries=buildGoalHistory(plans,metric);
  return <section className="panel">
    <div className="section-heading">
      <div>
        <h2>Goal history</h2>
        <p>When each goal started and ended, with your {metric==='trend'?'trend':'scale'} weight at the start and at the end.</p>
      </div>
    </div>
    {entries.length===0?<p className="empty">No goals yet.</p>:<div className="goal-history-list">
      {entries.map(entry=>{
        const isCurrent=entry.status==='active';
        const change=(entry.startKg!=null&&entry.endKg!=null)?entry.endKg-entry.startKg:null;
        const endDate=isCurrent?'Present':(entry.endDate??'—');
        return <article key={`${entry.startDate}-${entry.goal}`} className={`goal-history-card ${isCurrent?'goal-history-card-active':''}`}>
          <div className="goal-history-card-header">
            <div className="goal-history-title-group">
              <span className="eyebrow">{goalCategory(entry.goal)}</span>
              <h3 className="goal-history-title">{goalLabel(entry.goal)}</h3>
            </div>
            <span className={`goal-history-status-badge ${entry.status}`}>
              {isCurrent&&<span className="goal-pulse-dot" aria-hidden="true"/>}
              {statusText(entry)}
            </span>
          </div>
          <div className="goal-history-dates">
            <Calendar size={13} aria-hidden="true"/>
            <time dateTime={entry.startDate}>{entry.startDate}</time>
            <span className="goal-history-date-sep" aria-hidden="true">→</span>
            <time dateTime={entry.endDate??undefined}>{endDate}</time>
          </div>
          <div className="goal-history-stats">
            <div className="goal-history-stat-point">
              <span className="goal-history-stat-label">Start</span>
              <span className="goal-history-stat-val">
                {entry.startKg!=null?(
                  <>{displayWeight(entry.startKg,unit,1)} <span className="unit">{weightLabel(unit)}</span></>
                ):'—'}
              </span>
            </div>
            <div className="goal-history-stat-arrow" aria-hidden="true">
              <ArrowRight size={14}/>
            </div>
            <div className="goal-history-stat-point">
              <span className="goal-history-stat-label">{isCurrent?'Latest':'End'}</span>
              <span className="goal-history-stat-val">
                {entry.endKg!=null?(
                  <>{displayWeight(entry.endKg,unit,1)} <span className="unit">{weightLabel(unit)}</span></>
                ):'—'}
              </span>
            </div>
            {change!=null&&Math.abs(change)>=0.05&&(
              <div className="goal-history-change-tag">
                <span className="goal-history-stat-label">Change</span>
                <span className="goal-history-delta-badge">
                  {change>0?'+':'−'}{displayWeight(Math.abs(change),unit,1)} <span className="unit">{weightLabel(unit)}</span>
                </span>
              </div>
            )}
          </div>
        </article>;
      })}
    </div>}
  </section>;
}
