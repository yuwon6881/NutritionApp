import type {Entry,Mutation} from '../types';
import type {FoodScanDraft} from './foodScans';

export function mealTime(zone='Asia/Kuala_Lumpur',at:Date|number=new Date()){
  return new Intl.DateTimeFormat('en-GB',{timeZone:zone,hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(at);
}

/**
 * An AI scan's result can arrive long after the photo or description was captured (a
 * retried upload, a backgrounded app). The logged meal time must reflect that original
 * capture moment, not whenever the review happens to complete.
 */
export function scanMealTime(scanDraft:Pick<FoodScanDraft,'capturedAt'>|null|undefined,zone?:string){
  return scanDraft?.capturedAt!=null?mealTime(zone,scanDraft.capturedAt):mealTime(zone);
}
export function timeLabel(time:string){
  const [hour,minute]=time.split(':').map(Number);
  return `${hour%12||12}${minute?`:${String(minute).padStart(2,'0')}`:''} ${hour<12?'AM':'PM'}`;
}
/** Foods logged within this many minutes of the one before belong to the same sitting. */
export const sittingGapMinutes=30;
/** A sitting never runs longer than this from its first food, so a day of grazing still splits. */
export const sittingSpanMinutes=60;

export type TimelineGroup={
  /** The group's first logged time; it keys the row and is where an added or dropped food lands. */
  time:string;
  label:string;
  /** The last logged time, when the sitting spans more than one. */
  endLabel?:string;
  entries:Entry[];
};

const minutesOf=(time:string)=>{const [hour,minute]=time.split(':').map(Number);return hour*60+minute;};

/**
 * One row per sitting rather than per exact minute: a food joins the row before it when it was logged
 * within `sittingGapMinutes` of the previous food and within `sittingSpanMinutes` of the row's first.
 * A meal entered item by item therefore reads as one group with one set of totals. Foods with no
 * recorded time stay in their own last row.
 */
export function timelineGroups(entries:Entry[]):TimelineGroup[]{
  const timed=entries.filter((entry):entry is Entry&{time:string}=>!!entry.time)
    .sort((a,b)=>a.time.localeCompare(b.time)||a.id.localeCompare(b.id));
  const groups:TimelineGroup[]=[];
  let previous=-Infinity;
  let start=-Infinity;
  for(const entry of timed){
    const minutes=minutesOf(entry.time);
    const current=groups[groups.length-1];
    if(current&&minutes-previous<=sittingGapMinutes&&minutes-start<=sittingSpanMinutes){
      current.entries.push(entry);
      if(entry.time!==current.time)current.endLabel=timeLabel(entry.time);
    }else{
      groups.push({time:entry.time,label:timeLabel(entry.time),entries:[entry]});
      start=minutes;
    }
    previous=minutes;
  }
  const untimed=entries.filter(entry=>!entry.time).sort((a,b)=>a.id.localeCompare(b.id));
  if(untimed.length)groups.push({time:'',label:'Time not recorded',entries:untimed});
  return groups;
}

/**
 * The dedicated diary keeps an hourly drop target visible even when no food is
 * logged there. Exact entry times are added alongside those slots so a drag
 * can move an item to an empty hour without first opening the move dialog.
 */
export type TimelineView='data'|'full';

export function timelineSlots(entries:Entry[],startHour=0,endHour=23,view:TimelineView='full'){
  const occupied=timelineGroups(entries).filter(group=>group.time!=='');
  if(view==='data')return [...occupied,...(entries.some(entry=>!entry.time)?[{time:'',label:'Time not recorded',entries:entries.filter(entry=>!entry.time)}]:[])];
  const groups=new Map<string,TimelineGroup>(occupied.map(group=>[group.time,group]));
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

export function moveEntry(entry:Entry,time:string|null,date=entry.date):Omit<Mutation,'id'>|undefined{
  if((entry.time??null)===time&&entry.date===date)return undefined;
  return {kind:'entry',recordId:entry.id,expectedRevision:entry.revision,delete:false,data:{...entry,date,time}};
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

/**
 * Today may show only this device's entries when its history cannot load. While an online fetch is
 * still in flight the diary must keep loading: an empty device copy would read as "nothing logged".
 */
export function showsDeviceOnlyToday({isToday,hasHistory,loading,online}:{isToday:boolean;hasHistory:boolean;loading:boolean;online:boolean}){
  return isToday&&!hasHistory&&(!loading||!online);
}
