import type {CoachResult,Plan,WeightGoalMetric} from '../types';

export type GoalHistoryStatus='active'|'completed'|'changed';

export type GoalHistoryEntry={
  /** Date of the first accepted plan under this goal. */
  startDate:string;
  goal:string;
  startKg:number|null;
  /** Weight at the last accepted plan under this goal, by the chosen weight metric. */
  endKg:number|null;
  status:GoalHistoryStatus;
  /** Date the goal was completed or replaced; absent while it is still being pursued. */
  endDate?:string;
};

export const goalLabel=(goal:string)=>goal==='lose'?'Fat loss':goal==='gain'?'Bulking':'Maintenance';

type Snapshot={date:string;goal:string;profileRevision:number;startKg:number|null;weightKg:number|null;complete:boolean};

function snapshot(plan:Plan,metric:WeightGoalMetric):Snapshot|null{
  let result:CoachResult;
  try{result=JSON.parse(plan.resultJson) as CoachResult;}catch{return null;}
  const progress=result.goalProgress;
  const goal=progress?.goal??result.effectiveGoal;
  if(!goal)return null;
  const [first,second]=metric==='trend'?[progress?.trendWeight,progress?.scaleWeight]:[progress?.scaleWeight,progress?.trendWeight];
  return {date:plan.date,goal,profileRevision:plan.profileRevision??0,startKg:progress?.startWeight??null,weightKg:first??second??null,complete:Boolean(result.phaseComplete||progress?.complete)};
}

const sameGoal=(left:Snapshot,right:Snapshot)=>left.goal===right.goal&&left.profileRevision===right.profileRevision&&(left.startKg==null||right.startKg==null||Math.abs(left.startKg-right.startKg)<0.05);

/**
 * Collapses accepted plans into one entry per goal period. A period ends when the goal or its start
 * weight changes, or when the plan reports the goal complete. Returned newest first.
 */
export function buildGoalHistory(plans:readonly Plan[],metric:WeightGoalMetric='scale'):GoalHistoryEntry[]{
  // Plans arrive newest first; reversing before the stable sort keeps same-day plans in acceptance order.
  const snapshots=[...plans].reverse()
    .map(plan=>snapshot(plan,metric))
    .filter((item):item is Snapshot=>item!==null)
    .sort((left,right)=>left.date.localeCompare(right.date));
  const periods:Snapshot[][]=[];
  for(const item of snapshots){
    const current=periods.at(-1);
    if(current&&sameGoal(current[0],item))current.push(item);else periods.push([item]);
  }
  const entries=periods.map((period,index):GoalHistoryEntry=>{
    const first=period[0];
    const last=period.at(-1)!;
    const next=periods[index+1];
    const base={
      startDate:first.date,
      goal:first.goal,
      startKg:period.find(item=>item.startKg!=null)?.startKg??first.weightKg,
      endKg:[...period].reverse().find(item=>item.weightKg!=null)?.weightKg??null
    };
    if(next)return {...base,status:'changed',endDate:next[0].date};
    if(last.complete)return {...base,status:'completed',endDate:last.date};
    return {...base,status:'active'};
  });
  return entries.reverse();
}
