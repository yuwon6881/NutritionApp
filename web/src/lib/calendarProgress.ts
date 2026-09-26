import type {AppState,DatedDiaryDay,CoachResult} from '../types';
import {dailyCalories} from './dailyTargets';

export function calendarTarget(state:AppState,date:string):number|null{
  const interval=state.acceptedTargetIntervals?.find(item=>item.start<=date&&item.end>=date);
  if(interval)return dailyCalories(interval,date);
  const plan=state.plans.filter(item=>!item.deleted&&item.date<=date).sort((a,b)=>b.date.localeCompare(a.date))[0];
  if(!plan)return null;
  try{return dailyCalories(JSON.parse(plan.resultJson) as CoachResult,date);}catch{return null;}
}

export function calorieProgress(intake:number|null,target:number|null):number|null{
  if(intake==null||target==null||!Number.isFinite(intake)||!Number.isFinite(target)||target<=0)return null;
  return Math.max(0,Math.min(intake/target,1));
}

export function calendarIntake(day:DatedDiaryDay|undefined):number|null{
  if(!day)return null;
  if(day.day?.archived)return day.day.calories??null;
  const entries=day.entries.filter(entry=>!entry.deleted);
  if(entries.length)return entries.reduce((sum,entry)=>sum+entry.calories,0);
  return day.day?.status==='fasting'?0:null;
}
