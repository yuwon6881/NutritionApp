import type {GoalProgress,WeightGoalMetric} from '../types';

/** True while a reached goal still waits for the user's explicit completion decision. */
export function goalNeedsDecision(progress:GoalProgress|null|undefined,metric:WeightGoalMetric){
  if(!progress||progress.complete)return false;
  const trendReached=progress.trendReached===true;
  const scaleReached=progress.scaleReached===true;
  const awaiting=(progress.awaitingTrend===true||(metric==='trend'&&scaleReached))&&!trendReached;
  if(awaiting)return false;
  return progress.durationReached===true||(metric==='trend'?trendReached:(scaleReached||trendReached));
}
