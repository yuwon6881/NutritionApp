import type {GoalProgress} from '../types';
import {number} from '../lib/format';
export function GoalSummary({progress}:{progress:GoalProgress}){
  return <div className="goal-summary"><h3>{progress.complete?'Phase complete':progress.mode==='weight'?'Your weight goal':progress.mode==='duration'?'Your phase timeline':'Your ongoing phase'}</h3>
    {progress.percent!=null&&<><p><strong>{number(progress.percent,1)}%</strong> {progress.mode==='duration'?'of phase duration elapsed':'of weight goal achieved'}</p><progress max="100" value={progress.percent} aria-label={progress.mode==='duration'?'Phase duration progress':'Weight goal progress'}/></>}
    {progress.phaseEnd&&<p>Planned phase end: <strong>{progress.phaseEnd}</strong></p>}
    {progress.mode==='weight'&&<p>{progress.complete?'Goal reached':<>Estimated finish: <strong>{progress.estimatedFinish??'Not yet estimable'}</strong></>}</p>}
    {progress.weeklyChange!=null&&<p>Observed weight change: {number(progress.weeklyChange,2)} kg/week.</p>}
    <p className="source">{progress.explanation}</p>
  </div>;
}
