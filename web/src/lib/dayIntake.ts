import type {AppState,DatedDiaryDay,LocalData} from '../types';
import {sharedDiaryCoordinator} from './diaryCoordinator';
import {historySource,historyState,projectHistorySource} from './history';
import {calendarIntake} from './calendarProgress';

/** A date as the diary renders it, including retained edits that have not synced. */
function projectedDay(local:LocalData|null|undefined,date:string):DatedDiaryDay|undefined{
  const cached=sharedDiaryCoordinator.projectDate(date,local?.queue??[]);
  if(cached)return cached;
  const stored=local?historyState(local,date):undefined;
  return stored?{date,entries:stored.entries,day:stored.days[0],revision:stored.revision,fetchedAt:0}:undefined;
}

/**
 * Calendar intake evidence for each date of a strip; null when a day carries no intake evidence.
 * Uncached dates share one projection per stored snapshot instead of one per date.
 */
export function projectedDayIntakes(local:LocalData|null|undefined,dates:readonly string[]):Map<string,number|null>{
  const projections=new Map<AppState,AppState>();
  const result=new Map<string,number|null>();
  for(const date of dates){
    const cached=sharedDiaryCoordinator.projectDate(date,local?.queue??[]);
    const saved=cached||!local?undefined:historySource(local,date,{start:date,end:date});
    let stored:AppState|undefined;
    if(saved){
      stored=projections.get(saved);
      if(!stored){stored=projectHistorySource(local!,saved);projections.set(saved,stored);}
    }
    result.set(date,calendarIntake(cached??(stored?{date,entries:stored.entries.filter(entry=>entry.date===date),
      day:stored.days.find(day=>day.date===date),revision:stored.revision,fetchedAt:0}:undefined)));
  }
  return result;
}

/**
 * Calories already logged on a loaded date, where a loaded day without entries is zero.
 * Null when the date is not on this device, so a preview never mistakes unknown for empty.
 */
export function projectedDayCalories(local:LocalData|null|undefined,date:string):number|null{
  const day=projectedDay(local,date);
  if(!day)return null;
  if(day.day?.archived)return day.day.calories??null;
  return day.entries.filter(entry=>!entry.deleted).reduce((sum,entry)=>sum+entry.calories,0);
}
