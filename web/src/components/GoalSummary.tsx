import type {GoalProgress} from '../types';
import {number} from '../lib/format';

const heading=(progress:GoalProgress)=>progress.complete?'Goal reached'
  :progress.mode==='weight'?'Your weight goal'
  :progress.mode==='duration'?'Your phase timeline':'Your ongoing phase';
const scale=(progress:GoalProgress)=>progress.mode==='duration'
  ?'of your phase duration elapsed'
  :'of the weight change from your starting position';

export function GoalSummary({progress}:{progress:GoalProgress}){
  const weight=progress.mode==='weight';
  return <div className={`goal-summary${progress.complete?' goal-reached':''}`}>
    <div className="goal-summary-head">
      <h3>{heading(progress)}</h3>
      {progress.percent!=null&&<strong className="goal-percent">{number(progress.percent,1)}%</strong>}
    </div>
    {progress.percent!=null&&<>
      <progress max="100" value={progress.percent} aria-label={progress.mode==='duration'?'Phase duration progress':'Weight goal progress'}/>
      <p className="goal-scale">{number(progress.percent,1)}% {scale(progress)}.</p>
    </>}
    {weight&&<dl className="goal-figures">
      <div><dt>Start</dt><dd>{number(progress.startWeight,1)} kg</dd></div>
      <div><dt>Now</dt><dd>{number(progress.trendWeight,1)} kg</dd></div>
      <div><dt>Target</dt><dd>{number(progress.targetWeight,1)} kg</dd></div>
      <div><dt>Remaining</dt><dd>{number(progress.remaining,1)} kg</dd></div>
    </dl>}
    {progress.phaseEnd&&<p>Planned phase end: <strong>{progress.phaseEnd}</strong></p>}
    {weight&&!progress.complete&&<p>Estimated finish: <strong>{progress.estimatedFinish??'Not yet estimable'}</strong></p>}
    {progress.weeklyChange!=null&&<p>Observed weight change: {number(progress.weeklyChange,2)} kg/week.</p>}
    {progress.explanation&&<p className="source">{progress.explanation}</p>}
  </div>;
}
