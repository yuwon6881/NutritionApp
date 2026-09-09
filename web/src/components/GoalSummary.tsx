import type {GoalProgress} from '../types';
import {number} from '../lib/format';

const heading=(progress:GoalProgress)=>progress.complete?'Goal complete'
  :(progress.durationReached||progress.scaleReached||progress.trendReached)?'Goal reached'
  :progress.mode==='weight'?'Weight goal'
  :progress.mode==='duration'?'Phase timeline':'Ongoing phase';

export function GoalSummary({progress}:{progress:GoalProgress}){
  const weight=progress.mode==='weight';
  return <div className={`goal-summary${progress.complete?' goal-reached':''}`}>
    <div className="goal-summary-head">
      <h3>{heading(progress)}</h3>
      {progress.percent!=null&&<strong className="goal-percent">{number(progress.percent,1)}%</strong>}
    </div>
    {progress.percent!=null&&<progress max="100" value={progress.percent} aria-label={progress.mode==='duration'?'Phase duration progress':'Weight goal progress'}/>}
    <dl className="goal-figures">
      {weight&&<>
        <div><dt>Start</dt><dd>{number(progress.startWeight,1)} kg</dd></div>
        <div><dt>Now</dt><dd>{number(progress.trendWeight,1)} kg</dd></div>
        <div><dt>Target</dt><dd>{number(progress.targetWeight,1)} kg</dd></div>
        <div><dt>Remaining</dt><dd>{number(progress.remaining,1)} kg</dd></div>
      </>}
      {progress.phaseEnd&&<div><dt>Phase end</dt><dd>{progress.phaseEnd}</dd></div>}
      {weight&&!progress.complete&&!(progress.scaleReached||progress.trendReached)&&<div><dt>Estimated finish</dt><dd>{progress.estimatedFinish??'Not yet estimable'}</dd></div>}
      {progress.weeklyChange!=null&&<div><dt>Weekly change</dt><dd>{number(progress.weeklyChange,2)} kg</dd></div>}
    </dl>
  </div>;
}
