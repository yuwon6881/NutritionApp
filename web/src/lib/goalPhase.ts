import type {WeightGoalMetric} from '../types';
import {trend} from './format';

type GoalWeightPoint={date:string;kg:number;deleted?:boolean};

export function resolveGoalStartWeight({
  fallbackKg,
  weights,
  trendSeed,
  metric,
  current
}:{
  fallbackKg:number;
  weights:readonly GoalWeightPoint[];
  trendSeed:readonly GoalWeightPoint[];
  metric:WeightGoalMetric;
  current:string;
}):number{
  const points=[...trendSeed,...weights]
    .filter(point=>!point.deleted&&point.date<=current&&Number.isFinite(point.kg))
    .sort((left,right)=>left.date.localeCompare(right.date));
  if(!points.length)return fallbackKg;
  if(metric==='trend')return trend(points).at(-1)?.kg??points.at(-1)!.kg;
  return points.at(-1)!.kg;
}

export function goalWeightBounds(goal:string,startKg:number){
  const start=Math.min(Math.max(startKg,20),400);
  if(goal==='lose')return {min:20,max:start};
  if(goal==='gain')return {min:start,max:Math.min(400,start+80)};
  return {min:20,max:400};
}

export function phaseEndDate(start:string,durationWeeks:number){
  return new Date(Date.parse(start)+durationWeeks*7*86400000).toISOString().slice(0,10);
}