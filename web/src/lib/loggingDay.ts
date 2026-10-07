import type {AppState,MissingDayAction} from '../types';
import {today} from './format';
const shiftDate=(date:string,days:number)=>new Date(Date.parse(date)+days*86400000).toISOString().slice(0,10);

export function dayStatus(date:string,current:string,status:string|undefined,hasFood:boolean){
  if(date>=current)return 'incomplete';
  if(status==='fasting'||status==='not_logged')return status;
  return hasFood?'complete':'incomplete';
}
/** The first saved (not deleted) day record for each date. */
function savedDays(state:AppState){
  const days=new Map<string,AppState['days'][number]>();
  for(const day of state.days)if(!day.deleted&&!days.has(day.date))days.set(day.date,day);
  return days;
}
export function missingDays(state:AppState,current=today(state.profile?.timeZone),days=savedDays(state)){
  let first:string|undefined;
  for(const rows of [state.entries,state.weights,state.days,state.plans])for(const row of rows)if(!row.deleted&&(first===undefined||row.date<first))first=row.date;
  if(!first)return [];
  const start=first>state.start?first:state.start;
  const logged=new Set(state.entries.filter(e=>!e.deleted).map(e=>e.date));
  const result:string[]=[];
  for(let date=start;date<current&&date<=state.end;date=shiftDate(date,1)){
    const day=days.get(date);
    const food=day?.archived?(day.entryCount??0)>0:logged.has(date);
    if(!food&&day?.status!=='fasting'&&day?.status!=='not_logged')result.push(date);
  }
  return result;
}

/**
 * Return missing dates that a configured default may resolve automatically.
 * An explicit incomplete day is the user's choice to leave the date open, so
 * it must not be immediately changed back to the account default.
 */
export function automaticMissingDays(state:AppState,current=today(state.profile?.timeZone),action:MissingDayAction=state.settings?.missingDayAction??'ask'){
  if(action==='ask')return [];
  const days=savedDays(state);
  return missingDays(state,current,days).filter(date=>days.get(date)?.status!=='incomplete');
}
