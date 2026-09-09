import type {GoalProgress,PhaseDecision,Profile} from '../types';
import {trend} from './format';

const days=(from:string,to:string)=>Math.round((Date.parse(to)-Date.parse(from))/86400000);
const shift=(date:string,by:number)=>new Date(Date.parse(date)+by*86400000).toISOString().slice(0,10);

/**
 * Display mirror of the server GoalPolicy. It can surface reached milestones on a device that
 * recorded the weigh-in, but it never turns a reached milestone into a completed phase.
 */
export function liveGoalProgress(profile:Profile|null,weights:{date:string;kg:number}[],current:string,
  decision?:PhaseDecision):GoalProgress|null{
  if(!profile)return null;
  const mode=profile.phaseMode??'open';
  const raw=weights.filter(w=>w.date<=current).sort((a,b)=>a.date.localeCompare(b.date));
  const points=trend(raw);
  const currentWeight=points.at(-1)?.kg??null;
  const scaleWeight=raw.at(-1)?.kg??null;
  const startWeight=profile.phaseStartWeightKg??profile.weightKg??null;
  if(mode==='duration'){
    if(!profile.phaseStart||!profile.durationWeeks)return null;
    const total=profile.durationWeeks*7;
    const end=shift(profile.phaseStart,total);
    const durationReached=current>=end;
    const percent=Math.min(Math.max(100*days(profile.phaseStart,current)/total,0),100);
    return base(profile,'duration',durationReached?100:percent,currentWeight,startWeight,null,null,end,
      durationReached,false,false,durationReached?'duration':null,durationReached?end:null,scaleWeight);
  }
  if(mode!=='weight'||profile.targetWeightKg==null)
    return base(profile,'open',null,currentWeight,startWeight,null,null,null,false,false,false,null,null,scaleWeight);
  const target=profile.targetWeightKg;
  const percent=currentWeight!=null&&Math.abs(target-startWeight!)>.001
    ?Math.min(Math.max(100*(currentWeight-startWeight!)/(target-startWeight!),0),100)
    :null;
  const last=points.slice(-3);
  const trendReached=points.length>=3&&points.at(-1)!.date>=shift(current,-3)
    &&days(last[0].date,last[2].date)>=2
    &&last.every(w=>profile.goal==='lose'?w.kg<=target:w.kg>=target);
  const scaleReached=raw.length>0&&raw.at(-1)!.date>=shift(current,-3)
    &&(profile.goal==='lose'?raw.at(-1)!.kg<=target:raw.at(-1)!.kg>=target);
  const reached=trendReached||scaleReached;
  const remaining=currentWeight==null?null:reached?0:Math.max(profile.goal==='lose'?currentWeight-target:target-currentWeight,0);
  return base(profile,'weight',reached?100:percent,currentWeight,startWeight,target,remaining,null,
    false,scaleReached,trendReached,trendReached?'trend':scaleReached?'scale':null,
    trendReached?raw.at(-1)?.date??null:scaleReached?raw.at(-1)?.date??null:null,scaleWeight,decision?.decision==='await-trend');
}

function base(profile:Profile,mode:string,percent:number|null,currentWeight:number|null,startWeight:number|null,
  targetWeight:number|null,remaining:number|null,phaseEnd:string|null,durationReached:boolean,scaleReached:boolean,
  trendReached:boolean,reachedBy:string|null,reachedOn:string|null,scaleWeight:number|null,awaitingTrend=false):GoalProgress{
  return {mode,goal:profile.goal,percent,complete:false,estimatedFinish:null,phaseEnd,
    trendWeight:currentWeight,scaleWeight,startWeight,targetWeight,remaining,weeklyChange:null,explanation:'',
    durationReached,scaleReached,trendReached,reachedBy,reachedOn,awaitingTrend};
}

/** The accepted plan remains authoritative for completion; live data only raises reached flags. */
export function mergeGoalProgress(accepted:GoalProgress|undefined,live:GoalProgress|null,decision?:PhaseDecision):GoalProgress|null{
  if(!live){
    if(!accepted)return null;
    return decision?.decision==='completed'?{...accepted,complete:true}:accepted;
  }
  if(!accepted||accepted.mode!==live.mode){
    return {...live,complete:decision?.decision==='completed'};
  }
  const newlyReached=!accepted.complete&&(live.durationReached||live.scaleReached||live.trendReached);
  const complete=accepted.complete||decision?.decision==='completed';
  return {...accepted,...live,complete,
    durationReached:accepted.durationReached||live.durationReached,
    scaleReached:accepted.scaleReached||live.scaleReached,
    trendReached:accepted.trendReached||live.trendReached,
    reachedBy:live.reachedBy??accepted.reachedBy,
    reachedOn:live.reachedOn??accepted.reachedOn,
    awaitingTrend:decision?.decision==='await-trend'||live.awaitingTrend||accepted.awaitingTrend,
    phaseEnd:live.phaseEnd??accepted.phaseEnd,
    estimatedFinish:newlyReached&&!complete?null:accepted.estimatedFinish,
    weeklyChange:accepted.weeklyChange,
    explanation:newlyReached&&!complete?'':accepted.explanation};
}
