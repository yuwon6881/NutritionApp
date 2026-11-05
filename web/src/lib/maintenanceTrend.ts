import type {TrajectoryPoint} from '../types';
import {shiftDate} from './energyBalance';

/** Why the server held its maintenance estimate on a day, grouped into the few causes a person can act on. */
export type HoldKind='logging'|'weighIns'|'intakeChange'|'weightShift'|'unlogged'|'review'|'other';

export const holdLabel:Record<HoldKind,string>={
  logging:'Log more days',
  weighIns:'More weigh-ins',
  intakeChange:'Intake change settling',
  weightShift:'Weight shift settling',
  unlogged:'Unlogged days',
  review:'Check entries',
  other:'Holding'
};

// Ordered checks against the server's hold sentences in Domain/Expenditure.cs; the first match wins.
const holdPatterns:readonly [RegExp,HoldKind][]=[
  [/Holding: need at least \d+ logged days/,'logging'],
  [/retained weigh-ins spanning/,'weighIns'],
  [/Water and glycogen shift/,'intakeChange'],
  [/slopes disagree|do not cover both ends/,'weightShift'],
  [/across unlogged days/,'unlogged'],
  [/outside the supported range/,'review']
];

/** The hold cause for a trajectory point, or null when the estimate was free to move that day. */
export function holdKind(reason:string|null):HoldKind|null{
  if(reason==null)return null;
  return holdPatterns.find(([pattern])=>pattern.test(reason))?.[1]??'other';
}

export type MaintenanceDay={date:string;kcal:number|null;hold:HoldKind|null};
export type HoldRun={from:number;to:number;kind:HoldKind};
export type LineRun={from:number;to:number;held:boolean};

/**
 * One slot per calendar day from the first estimate inside [start, end] through end.
 * Days without a snapshot stay empty rather than borrowing a neighbour's value.
 */
export function maintenanceDays(points:readonly TrajectoryPoint[],start:string,end:string):MaintenanceDay[]{
  const latest=new Map<string,TrajectoryPoint>();
  for(const point of points){
    if(point.date<start||point.date>end||point.expenditure==null)continue;
    const current=latest.get(point.date);
    if(!current||point.revision>current.revision)latest.set(point.date,point);
  }
  if(!latest.size)return [];
  const first=[...latest.keys()].sort()[0];
  const days:MaintenanceDay[]=[];
  for(let date=first;date<=end;date=shiftDate(date,1)){
    const point=latest.get(date);
    days.push(point?{date,kcal:point.expenditure,hold:holdKind(point.holdReason)}:{date,kcal:null,hold:null});
  }
  return days;
}

/** Consecutive held days, split where the cause changes, for shading behind the line. */
export function holdRuns(days:readonly MaintenanceDay[]):HoldRun[]{
  const runs:HoldRun[]=[];
  days.forEach((day,index)=>{
    const last=runs.at(-1);
    if(day.kcal==null||day.hold==null)return;
    if(last&&last.to===index-1&&last.kind===day.hold)last.to=index;
    else runs.push({from:index,to:index,kind:day.hold});
  });
  return runs;
}

/**
 * Line pieces of one style. A piece starts on the previous piece's last day so the line
 * stays continuous where the estimate switches between moving and holding; gaps break it.
 */
export function lineRuns(days:readonly MaintenanceDay[]):LineRun[]{
  const runs:LineRun[]=[];
  days.forEach((day,index)=>{
    if(day.kcal==null)return;
    const held=day.hold!=null;
    const last=runs.at(-1);
    const joined=last?.to===index-1;
    if(joined&&last.held===held)last.to=index;
    else runs.push({from:joined?index-1:index,to:index,held});
  });
  return runs;
}
