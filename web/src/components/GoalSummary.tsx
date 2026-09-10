import type {GoalProgress,UnitPreferences} from '../types';
import {number} from '../lib/format';
import {defaultUnits,displayWeight,weightLabel} from '../lib/units';

const heading=(progress:GoalProgress)=>progress.complete?'Goal complete'
  :(progress.durationReached||progress.scaleReached||progress.trendReached)?'Goal reached'
  :progress.mode==='weight'?'Weight goal'
  :progress.mode==='duration'?'Phase timeline':'Ongoing phase';

export function GoalSummary({progress,units=defaultUnits}:{progress:GoalProgress;units?:UnitPreferences}){
  const weight=progress.mode==='weight';
  const unit=weightLabel(units.weight);
  return <div className={`goal-summary${progress.complete?' goal-reached':''}`}>
    <div className="goal-summary-head">
      <h3>{heading(progress)}</h3>
      {progress.percent!=null&&<strong className="goal-percent">{number(progress.percent,1)}%</strong>}
    </div>
    {progress.percent!=null&&<progress max="100" value={progress.percent} aria-label={progress.mode==='duration'?'Phase duration progress':'Weight goal progress'}/>}
    <dl className="goal-figures">
      {weight&&<>
        <div><dt>Start</dt><dd>{displayWeight(progress.startWeight,units.weight,1)} {unit}</dd></div>
        <div><dt>Now</dt><dd>{displayWeight(progress.trendWeight,units.weight,1)} {unit}</dd></div>
        <div><dt>Target</dt><dd>{displayWeight(progress.targetWeight,units.weight,1)} {unit}</dd></div>
        <div><dt>Remaining</dt><dd>{displayWeight(progress.remaining,units.weight,1)} {unit}</dd></div>
      </>}
      {progress.phaseEnd&&<div><dt>Phase end</dt><dd>{progress.phaseEnd}</dd></div>}
      {weight&&!progress.complete&&!(progress.scaleReached||progress.trendReached)&&<div><dt>Estimated finish</dt><dd>{progress.estimatedFinish??'Not yet estimable'}</dd></div>}
      {progress.weeklyChange!=null&&<div><dt>Weekly change</dt><dd>{displayWeight(progress.weeklyChange,units.weight,2)} {unit}</dd></div>}
    </dl>
  </div>;
}
