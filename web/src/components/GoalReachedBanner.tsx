import {Flag} from 'lucide-react';
import type {GoalProgress} from '../types';
import {number} from '../lib/format';
import {Button} from './ui/Button';

const reached=(progress:GoalProgress)=>{
  if(progress.mode==='duration')return `Your ${progress.goal==='gain'?'bulking':'fat-loss'} phase has run its full planned length.`;
  const target=progress.targetWeight!=null?`${number(progress.targetWeight,1)} kg`:'your target weight';
  return `Your smoothed weight has reached ${target}.`;
};

/**
 * A completed phase keeps its accepted calorie target until a new goal is chosen, so this
 * states the outcome and routes to the goal step rather than changing anything on its own.
 */
export function GoalReachedBanner({progress,onChooseGoal,action='Choose your next goal'}:{
  progress:GoalProgress|null|undefined;
  onChooseGoal:()=>void;
  action?:string;
}){
  if(!progress?.complete)return null;
  return <section className="panel goal-reached-banner" aria-labelledby="goal-reached-title">
    <div className="goal-reached-mark" aria-hidden="true"><Flag size={20}/></div>
    <div>
      <p className="eyebrow">GOAL REACHED</p>
      <h2 id="goal-reached-title">{progress.goal==='gain'?'Bulking':progress.goal==='lose'?'Fat loss':'Maintenance'} phase complete</h2>
      <p>{reached(progress)} Choose your next goal to resume coaching: your current target stays in place until you do.</p>
      {progress.mode==='weight'&&<p className="source">
        Start {number(progress.startWeight,1)} kg · now {number(progress.trendWeight,1)} kg · target {number(progress.targetWeight,1)} kg.
      </p>}
    </div>
    <Button variant="primary" size="md" onClick={onChooseGoal}>{action}</Button>
  </section>;
}
