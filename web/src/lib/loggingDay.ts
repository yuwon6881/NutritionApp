import type {AppState,MissingDayAction} from '../types';
import {today} from './format';
const shiftDate=(date:string,days:number)=>new Date(Date.parse(date)+days*86400000).toISOString().slice(0,10);

export function dayStatus(date:string,current:string,status:string|undefined,hasFood:boolean){
  if(date>=current)return 'incomplete';
  if(status==='fasting'||status==='not_logged')return status;
  return hasFood?'complete':'incomplete';
}
export function missingDays(state:AppState,current=today(state.profile?.timeZone)){
  const first=[...state.entries,...state.weights,...state.days,...state.plans].filter(r=>!r.deleted).map(r=>r.date).sort()[0];
  if(!first)return [];
  const start=[first,state.start].sort().at(-1)!;
  const result:string[]=[];
  for(let date=start;date<current&&date<=state.end;date=shiftDate(date,1)){
    const day=state.days.find(d=>!d.deleted&&d.date===date);
    const food=day?.archived?(day.entryCount??0)>0:state.entries.some(e=>!e.deleted&&e.date===date);
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
  return missingDays(state,current).filter(date=>state.days.find(day=>!day.deleted&&day.date===date)?.status!=='incomplete');
}
