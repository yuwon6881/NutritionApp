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
export {acknowledgeState as acknowledgeHistory} from './acknowledgeState';
