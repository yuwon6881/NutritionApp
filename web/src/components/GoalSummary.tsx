import type {GoalProgress,UnitPreferences,WeightGoalMetric} from '../types';
import {number,readableDate} from '../lib/format';
import {defaultUnits,displayWeight,weightLabel} from '../lib/units';

const heading=(progress:GoalProgress)=>progress.complete?'Goal complete'
  :(progress.durationReached||progress.scaleReached||progress.trendReached)?'Goal reached'
  :progress.mode==='weight'?'Weight goal'
  :progress.mode==='duration'?'Phase timeline':'Ongoing phase';

export function GoalSummary({progress,units=defaultUnits,weightGoalMetric='scale',titleId='dashboard-goal-title'}:{progress:GoalProgress;units?:UnitPreferences;weightGoalMetric?:WeightGoalMetric;titleId?:string}){
  const weight=progress.mode==='weight';
  const unit=weightLabel(units.weight);
  const currentWeight=weightGoalMetric==='trend'
    ?(progress.trendWeight??progress.scaleWeight??progress.startWeight)
    :(progress.scaleWeight??progress.startWeight);
  const startWeight=progress.startWeight;
  const targetWeight=progress.targetWeight;
  const trendWeight=progress.trendWeight??currentWeight;
  const isFarther=weight&&startWeight!=null&&targetWeight!=null&&trendWeight!=null&&((targetWeight-startWeight)*(trendWeight-startWeight)<0);
  const movement=isFarther&&startWeight!=null?trendWeight-startWeight:null;
  const movementFormatted=movement!=null?displayWeight(movement,units.weight,1):null;
  const awayText=movement!=null&&movementFormatted!=null&&movementFormatted!=='0'&&movementFormatted!=='0.0'?`${movement>0?'+':''}${movementFormatted} ${unit} since start`:null;
  const hasFigures=weight||Boolean(progress.phaseEnd)||progress.weeklyChange!=null;
  return <div className={`goal-summary${progress.complete?' goal-reached':''}`}>
    <div className="goal-summary-head">
      <div className="goal-summary-title-group">
        <p className="eyebrow">Goal progress</p>
        <h3 id={titleId}>{heading(progress)}</h3>
      </div>
      {progress.percent!=null&&<strong className="goal-percent">{number(progress.percent,1)}%{awayText?` · ${awayText}`:''}</strong>}
    </div>
    {progress.percent!=null&&<progress max="100" value={progress.percent} aria-label={progress.mode==='duration'?'Phase duration progress':'Weight goal progress'}/>}
    {!hasFigures&&<p className="source goal-summary-note">No end date or target weight is set. Accepted targets stay in place until you accept a new plan.</p>}
    {hasFigures&&<dl className="goal-figures">
      {weight&&<>
        <div><dt>Start</dt><dd>{displayWeight(progress.startWeight,units.weight,1)} <span className="unit">{unit}</span></dd></div>
        <div><dt>Now</dt><dd>{displayWeight(currentWeight,units.weight,1)} <span className="unit">{unit}</span></dd></div>
        <div><dt>Target</dt><dd>{displayWeight(progress.targetWeight,units.weight,1)} <span className="unit">{unit}</span></dd></div>
        <div><dt>Remaining</dt><dd>{displayWeight(progress.remaining,units.weight,1)} <span className="unit">{unit}</span></dd></div>
      </>}
      {progress.phaseEnd&&<div><dt>Phase end</dt><dd>{readableDate(progress.phaseEnd)}</dd></div>}
      {weight&&!progress.complete&&!(progress.scaleReached||progress.trendReached)&&<div><dt>Estimated finish</dt><dd className="goal-finish-date">{readableDate(progress.optimisticFinish??progress.estimatedFinish??'Not yet estimable')}</dd></div>}
      {progress.weeklyChange!=null&&<div><dt>Weekly change</dt><dd>{displayWeight(progress.weeklyChange,units.weight,1)} <span className="unit">{unit}</span></dd></div>}
    </dl>}
  </div>;
}
