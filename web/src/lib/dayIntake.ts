import type {DatedDiaryDay,LocalData} from '../types';
import {sharedDiaryCoordinator} from './diaryCoordinator';
import {historyState} from './history';
import {calendarIntake} from './calendarProgress';

/** A date as the diary renders it, including retained edits that have not synced. */
function projectedDay(local:LocalData|null|undefined,date:string):DatedDiaryDay|undefined{
  const cached=sharedDiaryCoordinator.projectDate(date,local?.queue??[]);
  if(cached)return cached;
  const stored=local?historyState(local,date):undefined;
  return stored?{date,entries:stored.entries,day:stored.days[0],revision:stored.revision,fetchedAt:0}:undefined;
}

/** Calendar intake evidence for a date; null when the day carries no intake evidence. */
export function projectedDayIntake(local:LocalData|null|undefined,date:string):number|null{
  return calendarIntake(projectedDay(local,date));
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
