import {dayStatus} from './loggingDay';
import {today} from './format';
import type {Day,Entry} from '../types';
export type EnergyEstimate={date:string;revision:number;expenditure:number};
export type EnergyRow={date:string;end:string;intake:number|null;maintenance:number|null;balance:number|null;complete:boolean;days:number;loggedDays:number};
type Input={entries:Pick<Entry,'date'|'calories'|'deleted'>[];days:Pick<Day,'date'|'status'|'deleted'|'archived'|'calories'|'entryCount'>[];estimates:EnergyEstimate[];current?:string};
export const shiftDate=(date:string,days:number)=>new Date(Date.parse(date)+days*86400000).toISOString().slice(0,10);
export function energyDays(input:Input,start:string,end:string):EnergyRow[]{
  const statuses=new Map(input.days.filter(d=>!d.deleted).map(d=>[d.date,d]));
  const totals=new Map<string,number>();for(const entry of input.entries)if(!entry.deleted)totals.set(entry.date,(totals.get(entry.date)??0)+entry.calories);
  const estimates=[...input.estimates].sort((a,b)=>a.date.localeCompare(b.date)||a.revision-b.revision);let cursor=0;let maintenance:number|null=null;const rows:EnergyRow[]=[];
  for(let date=start;date<=end;date=shiftDate(date,1)){
    while(cursor<estimates.length&&estimates[cursor].date<=date)maintenance=estimates[cursor++].expenditure;
    const status=statuses.get(date);const resolved=dayStatus(date,input.current??today(),status?.status,status?.archived?(status.entryCount??0)>0:totals.has(date));const complete=resolved==='complete'||resolved==='fasting';
    const intake=status?.archived?(complete||(status.entryCount??0)>0?status.calories??0:null):totals.get(date)??(complete?0:null);
    rows.push({date,end:date,intake,maintenance,balance:complete&&intake!=null&&maintenance!=null?intake-maintenance:null,complete,days:1,loggedDays:intake==null?0:1});
  }
  return rows;
}
export function groupEnergy(rows:EnergyRow[],mode:'day'|'week'|'month'):EnergyRow[]{
  if(mode==='day')return rows;
  const groups=new Map<string,EnergyRow[]>();
  for(const row of rows){const day=new Date(row.date).getUTCDay();const key=mode==='month'?row.date.slice(0,7):shiftDate(row.date,-((day+6)%7));groups.set(key,[...(groups.get(key)??[]),row]);}
  return [...groups.values()].map(items=>({date:items[0].date,end:items.at(-1)!.end,intake:items.some(r=>r.intake!=null)?items.reduce((s,r)=>s+(r.intake??0),0):null,maintenance:items.every(r=>r.maintenance!=null)?items.reduce((s,r)=>s+r.maintenance!,0):null,balance:items.every(r=>r.balance!=null)?items.reduce((s,r)=>s+r.balance!,0):null,complete:items.every(r=>r.complete),days:items.length,loggedDays:items.reduce((s,r)=>s+r.loggedDays,0)}));
}
