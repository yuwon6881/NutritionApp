import type {AppState,Entry} from '../types';
import {today} from './format';
import {shiftDate} from './energyBalance';

export function mealTime(zone='Asia/Kuala_Lumpur'){
  return new Intl.DateTimeFormat('en-GB',{timeZone:zone,hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(new Date());
}
export function timeLabel(time:string){
  const [hour,minute]=time.split(':').map(Number);
  return `${hour%12||12}${minute?`:${String(minute).padStart(2,'0')}`:''} ${hour<12?'AM':'PM'}`;
}
export function detailCutoff(state:AppState){
  // Recalculate on an offline foreground wake as well as accepting the server cutoff.
  return [state.detailCutoff??'2000-01-01',shiftDate(today(state.profile?.timeZone),1-(state.detailDays??90))].sort().at(-1)!;
}
export function mealReadOnly(state:AppState,date:string){
  return date<detailCutoff(state)||state.days.some(day=>day.date===date&&day.archived);
}
export function timelineGroups(entries:Entry[]){
  const times=[...new Set(['00:00',...entries.map(e=>e.time).filter((t):t is string=>!!t)])].sort();
  return [...times,...(entries.some(e=>!e.time)?['']:[])].map(time=>({
    time,label:time?timeLabel(time):'Time not recorded',
    entries:entries.filter(e=>(e.time??'')===time).sort((a,b)=>a.id.localeCompare(b.id))
  }));
}
