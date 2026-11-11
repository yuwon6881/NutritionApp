import {ArrowRight,Calendar,Equal,TrendingDown,TrendingUp} from 'lucide-react';
import type {CoachingSettings,Plan} from '../types';
import {buildGoalHistory,currentEndKg,goalLabel,type GoalHistoryEntry} from '../lib/goalHistory';
import {displayWeight,unitsFor,weightLabel} from '../lib/units';
import {mediumDate} from '../lib/format';

const statusText=(entry:GoalHistoryEntry)=>entry.status==='completed'?'Completed':entry.status==='changed'?'Changed':'In progress';
const goalIcon=(goal:string)=>goal==='lose'?TrendingDown:goal==='gain'?TrendingUp:Equal;

export function GoalHistoryPanel({plans,settings,latestKg}:{plans:readonly Plan[];settings?:CoachingSettings;latestKg?:number|null}){
  const unit=unitsFor(settings).weight;
  const metric=settings?.weightGoalMetric??'scale';
  const entries=buildGoalHistory(plans,metric);
  return <section className="panel">
    <div className="section-heading">
      <div><h2>Goal history</h2></div>
    </div>
    {entries.length===0?<p className="empty">No goals yet.</p>:<div className="goal-history-list">
      {entries.map(entry=>{
        const isCurrent=entry.status==='active';
        const endKg=currentEndKg(entry,latestKg);
        const change=(entry.startKg!=null&&endKg!=null)?endKg-entry.startKg:null;
        const GoalIcon=goalIcon(entry.goal);
        const endDate=isCurrent?'Present':(entry.endDate?mediumDate(entry.endDate):'—');
        return <article key={`${entry.startDate}-${entry.goal}`} className={`goal-history-card ${isCurrent?'goal-history-card-active':''}`}>
          <div className="goal-history-card-header">
            <div className="goal-history-heading">
              <span className="coach-icon-tile" aria-hidden="true"><GoalIcon size={18}/></span>
              <h3 className="goal-history-title">{goalLabel(entry.goal)}</h3>
            </div>
            <span className={`goal-history-status-badge ${entry.status}`}>
              {isCurrent&&<span className="goal-pulse-dot" aria-hidden="true"/>}
              {statusText(entry)}
            </span>
          </div>
          <div className="goal-history-dates">
            <Calendar size={13} aria-hidden="true"/>
            <time dateTime={entry.startDate}>{mediumDate(entry.startDate)}</time>
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
              <span className="goal-history-stat-label">{isCurrent?'Latest':'End'}{metric==='trend'&&' trend'}</span>
              <span className="goal-history-stat-val">
                {endKg!=null?(
                  <>{displayWeight(endKg,unit,1)} <span className="unit">{weightLabel(unit)}</span></>
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
