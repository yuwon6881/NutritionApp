import type {AcceptedTargetInterval,TrajectoryPoint} from '../types';
import {shiftDate} from './energyBalance';

/** One calendar day of coaching guidance; any figure the server did not provide stays null. */
export type CoachingDay={date:string;maintenance:number|null;goal:number|null;target:number|null};

/** An accepted plan's daily calories: its stated daily figure, or the average of its seven daily targets. */
export function acceptedDailyCalories(interval:AcceptedTargetInterval):number|null{
  if(interval.calories!=null)return interval.calories;
  const daily=interval.dailyCalories;
  return daily?.length===7?daily.reduce((sum,value)=>sum+value,0)/7:null;
}

/**
 * One slot per calendar day from the first day inside [start, end] with any guidance through end.
 * Each date reads the newest trajectory revision and the accepted plan in force that day, so
 * consecutive plans meet at their boundary and a plan change shows as one step.
 */
export function coachingDays(points:readonly TrajectoryPoint[],intervals:readonly AcceptedTargetInterval[],start:string,end:string):CoachingDay[]{
  const latest=new Map<string,TrajectoryPoint>();
  for(const point of points){
    if(point.date<start||point.date>end||(point.expenditure==null&&point.suggestedCalories==null))continue;
    const current=latest.get(point.date);
    if(!current||point.revision>current.revision)latest.set(point.date,point);
  }
  // A later-starting plan supersedes an earlier one on any overlapping day.
  const plans=intervals.flatMap(interval=>{
    const calories=acceptedDailyCalories(interval);
    return calories==null||interval.end<start||interval.start>end?[]:[{start:interval.start,end:interval.end,calories}];
  }).sort((a,b)=>b.start.localeCompare(a.start));
  const targetOn=(date:string)=>plans.find(plan=>plan.start<=date&&plan.end>=date)?.calories??null;
  const firstPoint=[...latest.keys()].sort()[0];
  const firstPlan=plans.length?plans.reduce((first,plan)=>plan.start<first?plan.start:first,plans[0].start):undefined;
  const candidates=[firstPoint,firstPlan&&(firstPlan<start?start:firstPlan)].filter((date):date is string=>!!date);
  if(!candidates.length)return [];
  const days:CoachingDay[]=[];
  for(let date=candidates.sort()[0];date<=end;date=shiftDate(date,1)){
    const point=latest.get(date);
    days.push({date,maintenance:point?.expenditure??null,goal:point?.suggestedCalories??null,target:targetOn(date)});
  }
  return days;
}

/** Index runs of consecutive days that have a value, so a line breaks across unknown days. */
export function knownRuns(values:readonly (number|null)[]):{from:number;to:number}[]{
  const runs:{from:number;to:number}[]=[];
  values.forEach((value,index)=>{
    if(value==null)return;
    const last=runs.at(-1);
    if(last&&last.to===index-1)last.to=index;
    else runs.push({from:index,to:index});
  });
  return runs;
}

/** Plain-language gap between a day's accepted target and its maintenance, or null when either is unknown. */
export function targetGapLabel(day:Pick<CoachingDay,'maintenance'|'target'>,format:(value:number)=>string,unit:string):string|null{
  if(day.maintenance==null||day.target==null)return null;
  const gap=Math.round(day.target-day.maintenance);
  if(Math.abs(gap)<1)return 'Target matches maintenance';
  return `Target is ${format(Math.abs(gap))} ${unit}/day ${gap<0?'below':'above'} maintenance (a ${gap<0?'deficit':'surplus'})`;
}
