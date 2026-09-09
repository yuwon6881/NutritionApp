import type {AppState,LocalData,Mutation} from '../types';
import {project} from './projection';
import {shiftDate} from './energyBalance';
import {today} from './format';

export function historyRange(key:string,current:string){
  if(/^\d{4}$/.test(key))return {start:`${key}-01-01`,end:key===current.slice(0,4)?current:`${key}-12-31`};
  const end=key==='recent'?current:key;
  return {start:key==='recent'?shiftDate(end,-89):end,end};
}
export function clipHistory(state:AppState,start:string,end:string):AppState{
  const inside=(row:{date:string})=>row.date>=start&&row.date<=end;
  const seeds=new Map([...(state.weightTrendSeed??[]),...state.weights].filter(w=>w.date<start&&w.date>=shiftDate(start,-56)).map(w=>[w.date,w]));
  return {...state,start,end,entries:state.entries.filter(inside),days:state.days.filter(inside),weights:state.weights.filter(inside),weightTrendSeed:[...seeds.values()].filter(w=>!w.deleted).sort((a,b)=>a.date.localeCompare(b.date))};
}
export function historyState(local:LocalData,key:string):AppState|undefined{
  const range=historyRange(key,today(local.state.profile?.timeZone));
  const candidates=[local.history?.[key],local.state,...Object.values(local.history??{})]
    .filter((s):s is AppState=>!!s&&s.id===local.state.id&&s.start<=range.start&&s.end>=range.end)
    .sort((a,b)=>b.revision-a.revision);
  const saved=candidates[0];
  if(!saved)return undefined;
  const projected=project({...saved,profile:local.state.profile,detailDays:local.state.detailDays,detailCutoff:local.state.detailCutoff},local.queue);
  return clipHistory(projected,range.start,range.end);
}
export function acknowledgeHistory(state:AppState,op:Mutation,revision:number){
  const next=project(state,[op]);next.revision=revision;
  if(op.kind==='profile')next.profileRevision=revision;
  else if(op.kind==='settings'){if(next.settings)next.settings.revision=revision;}
  else {
    const key=({entry:'entries',food:'foods',weight:'weights',day:'days'} as const)[op.kind];
    const row=next[key].find(r=>r.id===op.recordId);
    if(row)row.revision=revision;
    if(op.kind==='entry'){
      const dates=[(op.data as {date?:string}).date,state.entries.find(e=>e.id===op.recordId)?.date];
      for(const day of next.days)if(dates.includes(day.date))day.revision=revision;
    }
  }
  return next;
}
