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

export function goalWeightBounds(goal:string,startKg:number,heightCm?:number){
  const start=Math.min(Math.max(startKg,20),400);
  const bmiFloor=heightCm&&heightCm>0?18.5*Math.pow(heightCm/100,2):20;
  if(goal==='lose')return {min:Math.min(start,Math.ceil(Math.max(20,start*0.8,bmiFloor)*10)/10),max:start};
  if(goal==='gain')return {min:start,max:Math.max(start,Math.floor(Math.min(400,start*1.2)*10)/10)};
  return {min:20,max:400};
}

export function phaseEndDate(start:string,durationWeeks:number){
  return new Date(Date.parse(start)+durationWeeks*7*86400000).toISOString().slice(0,10);
}
