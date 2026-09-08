import type {GoalProgress,Profile} from '../types';
import {trend} from './format';

const days=(from:string,to:string)=>Math.round((Date.parse(to)-Date.parse(from))/86400000);
const shift=(date:string,by:number)=>new Date(Date.parse(date)+by*86400000).toISOString().slice(0,10);

/**
 * Display mirror of the server GoalPolicy so a reached goal is visible on the device that
 * recorded the weigh-in. The server plan stays authoritative for every calorie decision.
 */
export function liveGoalProgress(profile:Profile|null,weights:{date:string;kg:number}[],current:string):GoalProgress|null{
  if(!profile)return null;
  const mode=profile.phaseMode??'open';
  const points=trend(weights.filter(w=>w.date<=current));
  const currentWeight=points.at(-1)?.kg??null;
  const startWeight=profile.phaseStartWeightKg??profile.weightKg??null;
  if(mode==='duration'){
    if(!profile.phaseStart||!profile.durationWeeks)return null;
    const total=profile.durationWeeks*7;
    const end=shift(profile.phaseStart,total);
    const percent=Math.min(Math.max(100*days(profile.phaseStart,current)/total,0),100);
    return base(profile,'duration',percent,current>=end,currentWeight,startWeight,null,null,end);
  }
  if(mode!=='weight'||profile.targetWeightKg==null)
    return base(profile,'open',null,false,currentWeight,startWeight,null,null,null);
  const target=profile.targetWeightKg;
  const percent=currentWeight!=null&&Math.abs(target-startWeight!)>.001
    ?Math.min(Math.max(100*(currentWeight-startWeight!)/(target-startWeight!),0),100)
    :null;
  // Three smoothed weights past the target, spanning at least two days, keep one heavy meal
  // or a single dry morning from declaring the phase finished.
  const last=points.slice(-3);
  const complete=points.length>=3&&points[points.length-1].date>=shift(current,-3)
    &&days(last[0].date,last[2].date)>=2
    &&last.every(w=>profile.goal==='lose'?w.kg<=target:w.kg>=target);
  const remaining=currentWeight==null?null
    :complete?0:Math.max(profile.goal==='lose'?currentWeight-target:target-currentWeight,0);
  return base(profile,'weight',complete?100:percent,complete,currentWeight,startWeight,target,remaining,null);
}

function base(profile:Profile,mode:string,percent:number|null,complete:boolean,currentWeight:number|null,
  startWeight:number|null,targetWeight:number|null,remaining:number|null,phaseEnd:string|null):GoalProgress{
  return {mode,goal:profile.goal,percent,complete,estimatedFinish:null,phaseEnd,
    trendWeight:currentWeight,startWeight,targetWeight,remaining,weeklyChange:null,explanation:''};
}

/**
 * The accepted plan carries the server's finish estimate and wording; the live mirror carries
 * today's weigh-ins. An accepted completion stays complete even if the weight later drifts back.
 */
export function mergeGoalProgress(accepted:GoalProgress|undefined,live:GoalProgress|null):GoalProgress|null{
  if(!live)return accepted??null;
  if(!accepted||accepted.mode!==live.mode)return live;
  const complete=accepted.complete||live.complete;
  const newlyComplete=complete&&!accepted.complete;
  return {...accepted,...live,complete,
    phaseEnd:live.phaseEnd??accepted.phaseEnd,
    // A finish estimate and its wording predate a completion the server has not reviewed yet.
    estimatedFinish:newlyComplete?null:accepted.estimatedFinish,
    weeklyChange:accepted.weeklyChange,
    explanation:newlyComplete?'':accepted.explanation};
}
