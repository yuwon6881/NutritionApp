import type {GoalProgress,PhaseDecision,Profile,WeightGoalMetric} from '../types';
import {trend} from './format';

const days=(from:string,to:string)=>Math.round((Date.parse(to)-Date.parse(from))/86400000);
const shift=(date:string,by:number)=>new Date(Date.parse(date)+by*86400000).toISOString().slice(0,10);

function robustSlope(points:{date:string;kg:number}[]):number{
  const slopes:number[]=[];
  for(let i=0;i<points.length;i++){
    for(let j=i+1;j<points.length;j++){
      const d=days(points[i].date,points[j].date);
      if(d!==0)slopes.push((points[j].kg-points[i].kg)/d);
    }
  }
  slopes.sort((a,b)=>a-b);
  if(!slopes.length)return 0;
  const mid=Math.floor(slopes.length/2);
  return slopes.length%2===1?slopes[mid]:(slopes[mid-1]+slopes[mid])/2;
}

/**
 * Display mirror of the server GoalPolicy. It surfaces reached milestones on a device that
 * recorded the weigh-in, computes dynamic goal percentage and optimistic finish date based on
 * the chosen weight goal metric (scale vs trend).
 */
export function liveGoalProgress(
  profile:Profile|null,
  weights:{date:string;kg:number}[],
  current:string,
  decision?:PhaseDecision,
  weightGoalMetric:WeightGoalMetric='scale'
):GoalProgress|null{
  if(!profile)return null;
  const mode=profile.phaseMode??'open';
  const raw=weights.filter(w=>w.date<=current).sort((a,b)=>a.date.localeCompare(b.date));
  const points=trend(raw);
  const trendWeight=points.at(-1)?.kg??null;
  const scaleWeight=raw.at(-1)?.kg??null;
  const startWeight=profile.phaseStartWeightKg??profile.weightKg??null;

  if(mode==='duration'){
    if(!profile.phaseStart||!profile.durationWeeks)return null;
    const total=profile.durationWeeks*7;
    const end=shift(profile.phaseStart,total);
    const durationReached=current>=end;
    const percent=Math.min(Math.max(100*days(profile.phaseStart,current)/total,0),100);
    const roundedPercent=Math.round(percent*10)/10;
    return base(profile,'duration',durationReached?100:roundedPercent,trendWeight,startWeight,null,null,end,
      durationReached,false,false,durationReached?'duration':null,durationReached?end:null,scaleWeight,false,null);
  }

  if(mode!=='weight'||profile.targetWeightKg==null)
    return base(profile,'open',null,trendWeight,startWeight,null,null,null,false,false,false,null,null,scaleWeight,false,null);

  const target=profile.targetWeightKg;
  const currentMetricWeight=weightGoalMetric==='trend'
    ?(trendWeight??scaleWeight??startWeight)
    :(scaleWeight??startWeight);

  const totalDelta=startWeight!=null?target-startWeight:0;
  const progressDelta=startWeight!=null&&currentMetricWeight!=null?currentMetricWeight-startWeight:0;
  const rawPercent=startWeight!=null&&Math.abs(totalDelta)>0.001
    ?Math.min(Math.max(100*progressDelta/totalDelta,0),100)
    :0;
  const percent=Math.round(rawPercent*10)/10;

  const last=points.slice(-3);
  const trendReached=points.length>=3&&points.at(-1)!.date>=shift(current,-3)
    &&days(last[0].date,last[2].date)>=2
    &&last.every(w=>profile.goal==='lose'?w.kg<=target:w.kg>=target);
  const scaleReached=raw.length>0&&raw.at(-1)!.date>=shift(current,-3)
    &&(profile.goal==='lose'?raw.at(-1)!.kg<=target:raw.at(-1)!.kg>=target);

  const goalReached=weightGoalMetric==='trend'?trendReached:(scaleReached||trendReached);
  const complete=decision?.decision==='completed';
  const remaining=currentMetricWeight==null?null:(goalReached||complete)?0:Math.max(profile.goal==='lose'?currentMetricWeight-target:target-currentMetricWeight,0);

  // Optimistic finish date calculation
  let optimisticFinish:string|null=null;
  if(goalReached||complete||(remaining!=null&&remaining<=0.001)){
    optimisticFinish=current;
  }else if(remaining!=null&&remaining>0&&(profile.goal==='lose'||profile.goal==='gain')){
    const goalRatePercent=Math.abs(profile.goalRatePercent??(profile.goal==='lose'?0.5:0.15));
    const plannedWeeklyKg=(goalRatePercent/100)*(currentMetricWeight??startWeight??70);
    const plannedDailyKg=plannedWeeklyKg/7;

    const recentWeighIns=raw.filter(w=>w.date>=shift(current,-28));
    let observedDailyKg=0;
    if(recentWeighIns.length>=2&&days(recentWeighIns[0].date,recentWeighIns.at(-1)!.date)>=3){
      const s=robustSlope(recentWeighIns);
      if((profile.goal==='lose'&&s<0)||(profile.goal==='gain'&&s>0)){
        observedDailyKg=Math.abs(s);
      }
    }
    const optimisticDailyKg=Math.max(plannedDailyKg,observedDailyKg);
    if(optimisticDailyKg>0.0001){
      const daysNeeded=Math.ceil(remaining/optimisticDailyKg);
      if(daysNeeded<=730){
        optimisticFinish=shift(current,daysNeeded);
      }
    }
  }

  const reachedBy=trendReached?'trend':scaleReached?'scale':null;
  const reachedOn=trendReached?raw.at(-1)?.date??null:scaleReached?raw.at(-1)?.date??null:null;

  return base(
    profile,'weight',goalReached?100:percent,trendWeight,startWeight,target,remaining,null,
    false,scaleReached,trendReached,reachedBy,reachedOn,scaleWeight,decision?.decision==='await-trend',optimisticFinish
  );
}

function base(
  profile:Profile,
  mode:string,
  percent:number|null,
  currentWeight:number|null,
  startWeight:number|null,
  targetWeight:number|null,
  remaining:number|null,
  phaseEnd:string|null,
  durationReached:boolean,
  scaleReached:boolean,
  trendReached:boolean,
  reachedBy:string|null,
  reachedOn:string|null,
  scaleWeight:number|null,
  awaitingTrend=false,
  optimisticFinish:string|null=null
):GoalProgress{
  return {
    mode,
    goal:profile.goal,
    percent,
    complete:false,
    estimatedFinish:optimisticFinish,
    optimisticFinish,
    phaseEnd,
    trendWeight:currentWeight,
    scaleWeight,
    startWeight,
    targetWeight,
    remaining,
    weeklyChange:null,
    explanation:'',
    durationReached,
    scaleReached,
    trendReached,
    reachedBy,
    reachedOn,
    awaitingTrend
  };
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
  return {
    ...accepted,
    ...live,
    complete,
    durationReached:accepted.durationReached||live.durationReached,
    scaleReached:accepted.scaleReached||live.scaleReached,
    trendReached:accepted.trendReached||live.trendReached,
    reachedBy:live.reachedBy??accepted.reachedBy,
    reachedOn:live.reachedOn??accepted.reachedOn,
    awaitingTrend:decision?.decision==='await-trend'||live.awaitingTrend||accepted.awaitingTrend,
    phaseEnd:live.phaseEnd??accepted.phaseEnd,
    percent:newlyReached||complete?100:(live.percent??accepted.percent),
    remaining:newlyReached||complete?0:(live.remaining??accepted.remaining),
    estimatedFinish:newlyReached&&!complete?null:(live.estimatedFinish??accepted.estimatedFinish),
    optimisticFinish:newlyReached&&!complete?null:(live.optimisticFinish??accepted.optimisticFinish??live.estimatedFinish),
    weeklyChange:live.weeklyChange??accepted.weeklyChange,
    explanation:newlyReached&&!complete?'':(live.explanation||accepted.explanation)
  };
}
