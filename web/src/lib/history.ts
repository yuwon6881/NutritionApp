import type {AppState,LocalData} from '../types';
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
  const seedStart=shiftDate(start,-56);
  const seeds=new Map([...(state.weightTrendSeed??[]),...state.weights].filter(w=>w.date<start&&w.date>=seedStart).map(w=>[w.date,w]));
  return {...state,start,end,entries:state.entries.filter(inside),days:state.days.filter(inside),weights:state.weights.filter(inside),weightTrendSeed:[...seeds.values()].filter(w=>!w.deleted).sort((a,b)=>a.date.localeCompare(b.date))};
}
/** The newest stored snapshot of this account that covers the whole range. */
export function historySource(local:LocalData,key:string,range:{start:string;end:string}):AppState|undefined{
  return [local.history?.[key],local.state,...Object.values(local.history??{})]
    .filter((s):s is AppState=>!!s&&s.id===local.state.id&&s.start<=range.start&&s.end>=range.end)
    .sort((a,b)=>b.revision-a.revision)[0];
}
/** A stored snapshot with the retained queue applied; clip it to the range being read. */
export function projectHistorySource(local:LocalData,saved:AppState):AppState{
  return project({...saved,profile:local.state.profile,detailDays:local.state.detailDays,detailCutoff:local.state.detailCutoff},local.queue);
}
export function historyState(local:LocalData,key:string):AppState|undefined{
  const range=historyRange(key,today(local.state.profile?.timeZone));
  const saved=historySource(local,key,range);
  return saved?clipHistory(projectHistorySource(local,saved),range.start,range.end):undefined;
}
export {acknowledgeState as acknowledgeHistory} from './acknowledgeState';
