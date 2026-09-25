import type {GoalProgress,UnitPreferences,WeightGoalMetric} from '../types';
import {number} from '../lib/format';
import {defaultUnits,displayWeight,weightLabel} from '../lib/units';

const heading=(progress:GoalProgress)=>progress.complete?'Goal complete'
  :(progress.durationReached||progress.scaleReached||progress.trendReached)?'Goal reached'
  :progress.mode==='weight'?'Weight goal'
  :progress.mode==='duration'?'Phase timeline':'Ongoing phase';

export function GoalSummary({progress,units=defaultUnits,weightGoalMetric='scale'}:{progress:GoalProgress;units?:UnitPreferences;weightGoalMetric?:WeightGoalMetric}){
  const weight=progress.mode==='weight';
  const unit=weightLabel(units.weight);
  const currentWeight=weightGoalMetric==='trend'
    ?(progress.trendWeight??progress.scaleWeight??progress.startWeight)
    :(progress.scaleWeight??progress.startWeight);
  const hasFigures=weight||Boolean(progress.phaseEnd)||progress.weeklyChange!=null;
  return <div className={`goal-summary${progress.complete?' goal-reached':''}`}>
    <div className="goal-summary-head">
      <h3>{heading(progress)}</h3>
      {progress.percent!=null&&<strong className="goal-percent">{number(progress.percent,1)}%</strong>}
    </div>
    {progress.percent!=null&&<progress max="100" value={progress.percent} aria-label={progress.mode==='duration'?'Phase duration progress':'Weight goal progress'}/>}
    {!hasFigures&&<p className="source goal-summary-note">No end date or target weight is set. Accepted targets stay in place until you accept a new plan.</p>}
    {hasFigures&&<dl className="goal-figures">
      {weight&&<>
        <div><dt>Start</dt><dd>{displayWeight(progress.startWeight,units.weight,1)} {unit}</dd></div>
        <div><dt>Now</dt><dd>{displayWeight(currentWeight,units.weight,1)} {unit}</dd></div>
        <div><dt>Target</dt><dd>{displayWeight(progress.targetWeight,units.weight,1)} {unit}</dd></div>
        <div><dt>Remaining</dt><dd>{displayWeight(progress.remaining,units.weight,1)} {unit}</dd></div>
      </>}
      {progress.phaseEnd&&<div><dt>Phase end</dt><dd>{progress.phaseEnd}</dd></div>}
      {weight&&!progress.complete&&!(progress.scaleReached||progress.trendReached)&&<div><dt>Estimated finish</dt><dd>{progress.optimisticFinish??progress.estimatedFinish??'Not yet estimable'}</dd></div>}
      {progress.weeklyChange!=null&&<div><dt>Weekly change</dt><dd>{displayWeight(progress.weeklyChange,units.weight,2)} {unit}</dd></div>}
    </dl>}
  </div>;
}
