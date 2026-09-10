import type {AppState,Entry,Mutation} from '../types';
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

/**
 * The dedicated diary keeps an hourly drop target visible even when no food is
 * logged there. Exact entry times are added alongside those slots so a drag
 * can move an item to an empty hour without first opening the move dialog.
 */
export type TimelineView='data'|'full';

export function timelineSlots(entries:Entry[],startHour=0,endHour=23,view:TimelineView='full'){
  const occupied=timelineGroups(entries).filter(group=>group.time!==''&&(group.time!=='00:00'||entries.some(entry=>entry.time==='00:00')));
  if(view==='data')return [...occupied,...(entries.some(entry=>!entry.time)?[{time:'',label:'Time not recorded',entries:entries.filter(entry=>!entry.time)}]:[])];
  const groups=new Map(occupied.map(group=>[group.time,group]));
  for(let hour=startHour;hour<=endHour;hour++){
    const time=`${String(hour).padStart(2,'0')}:00`;
    if(!groups.has(time))groups.set(time,{time,label:timeLabel(time),entries:[]});
  }
  const slots=[...groups.values()].sort((a,b)=>a.time.localeCompare(b.time));
  if(entries.some(entry=>!entry.time))slots.push({time:'',label:'Time not recorded',entries:entries.filter(entry=>!entry.time)});
  return slots;
}

export const timePattern=/^(?:[01][0-9]|2[0-3]):[0-5][0-9]$/;

export function normalizeTime(value?:string|null):string|null|undefined{
  if(value==null||value==='')return null;
  return timePattern.test(value)?value:undefined;
}

export function moveTargets(groups:{time:string;label:string;entries:Entry[]}[],from?:string|null){
  return groups.filter(g=>g.time!=='').map(g=>({
    time:g.time,
    label:g.label,
    count:g.entries.length,
    current:g.time===(from??'')
  }));
}

export function moveEntry(entry:Entry,time:string|null):Omit<Mutation,'id'>|undefined{
  if((entry.time??null)===time)return undefined;
  return {kind:'entry',recordId:entry.id,expectedRevision:entry.revision,delete:false,data:{...entry,time}};
}

export function moveAnnouncement(count:number,time:string|null):string{
  const target=time?timeLabel(time):'Time not recorded';
  return `Moved ${count} ${count===1?'entry':'entries'} to ${target}.`;
}

export interface DropRow{
  time:string;
  top:number;
  bottom:number;
}

export function dropTarget(rows:DropRow[],y:number):string|undefined{
  if(!rows.length)return undefined;
  if(y<=rows[0].top)return rows[0].time;
  if(y>=rows[rows.length-1].bottom)return rows[rows.length-1].time;
  const inside=rows.find(r=>y>=r.top&&y<=r.bottom);
  if(inside)return inside.time;
  let closest=rows[0];
  let minDiff=Math.abs(y-(rows[0].top+rows[0].bottom)/2);
  for(let i=1;i<rows.length;i++){
    const diff=Math.abs(y-(rows[i].top+rows[i].bottom)/2);
    if(diff<minDiff){
      minDiff=diff;
      closest=rows[i];
    }
  }
  return closest.time;
}
