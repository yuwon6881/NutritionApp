import {Flag} from 'lucide-react';
import type {GoalProgress} from '../types';
import type {NutritionStore} from '../useNutritionStore';
import {displayWeight,unitsFor,weightLabel} from '../lib/units';
import {Button} from './ui/Button';

/**
 * Status that follows the goal-complete ring: a waiting-for-trend notice, then the completed
 * phase with the way to the next plan. The reached-but-undecided state is the ring and its dialog.
 */
export function GoalReachedBanner({progress,onChooseGoal,action='Choose your next goal',store}: {
  progress:GoalProgress|null|undefined;
  onChooseGoal:()=>void;
  action?:string;
  store?:NutritionStore;
}){
  if(!progress)return null;
  const settings=store?.state?.settings;
  const metric=settings?.weightGoalMetric??'scale';
  const title=progress.goal==='gain'?'Bulking':progress.goal==='lose'?'Fat loss':'Maintenance';
  const units=unitsFor(settings);
  const shown=(value:number|null|undefined)=>`${displayWeight(value,units.weight,1)} ${weightLabel(units.weight)}`;
  const awaiting=(progress.awaitingTrend===true||(metric==='trend'&&progress.scaleReached===true))&&progress.trendReached!==true&&!progress.complete;

  if(awaiting)
    return <p className="notice goal-awaiting-trend">Waiting for trend weight · Scale {shown(progress.scaleWeight)} · Trend {shown(progress.trendWeight)} · Target {shown(progress.targetWeight)}</p>;
  if(!progress.complete)return null;
  return <section className="panel goal-reached-banner" aria-labelledby="goal-reached-title">
    <div className="goal-reached-mark" aria-hidden="true"><Flag size={20}/></div>
    <div>
      <h2 id="goal-reached-title">{title} phase complete</h2>
      {progress.mode==='weight'&&<p>Start {shown(progress.startWeight)} · now {shown(progress.trendWeight??progress.scaleWeight)} · target {shown(progress.targetWeight)}.</p>}
    </div>
    <Button variant="primary" size="md" onClick={onChooseGoal}>{action}</Button>
  </section>;
}
