import type {Day,Entry} from '../types';

export interface RecentIntake {averageKcal:number;days:number}

const shift=(date:string,days:number)=>new Date(Date.parse(`${date}T00:00:00Z`)+days*86400000).toISOString().slice(0,10);

/**
 * Average intake over the most recent logged days in the week before a weigh-in. A fasting decision counts as zero;
 * a not-logging decision or a day without entries is skipped, never read as zero.
 */
export function recentIntake(entries:readonly Entry[],days:readonly Day[],date:string,count=3):RecentIntake|null{
  const totals:number[]=[];
  for(let offset=1;offset<=7&&totals.length<count;offset++){
    const day=shift(date,-offset);
    const saved=days.find(item=>!item.deleted&&item.date===day);
    if(saved?.status==='not_logged')continue;
    if(saved?.status==='fasting'){totals.push(0);continue;}
    if(saved?.archived){if(saved.calories!=null)totals.push(saved.calories);continue;}
    const logged=entries.filter(entry=>!entry.deleted&&entry.date===day);
    if(logged.length)totals.push(logged.reduce((sum,entry)=>sum+entry.calories,0));
  }
  if(totals.length<2)return null;
  return {averageKcal:totals.reduce((sum,value)=>sum+value,0)/totals.length,days:totals.length};
}

const count=(value:number,noun:string)=>`${value} ${noun}${value===1?'':'s'}`;

/** Plain-language summary of how marked weigh-ins shaped a check-in; null when nothing was adjusted. */
export function contextAdjustmentSummary(evidence:{contextExcluded?:number;contextSettling?:number;contextReinstated?:number}|null|undefined){
  const excluded=evidence?.contextExcluded??0;
  const settling=evidence?.contextSettling??0;
  const reinstated=evidence?.contextReinstated??0;
  const parts:string[]=[];
  if(excluded)parts.push(`${count(excluded,'weigh-in')} you marked as temporary ${excluded===1?'was':'were'} left out`);
  if(settling)parts.push(`${count(settling,'later weigh-in')} counted less while water settled`);
  if(reinstated)parts.push(`${count(reinstated,'marked weigh-in')} counted again because the weight stayed`);
  if(!parts.length)return null;
  const sentence=parts.join('; ');
  return `${sentence[0].toUpperCase()}${sentence.slice(1)}.`;
}
