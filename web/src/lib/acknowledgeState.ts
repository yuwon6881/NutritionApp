import type {AppState,Mutation} from '../types';
import {project} from './projection';

/** Acknowledgement may touch an archived record that projection deliberately left shared. */
export function acknowledgeState(state:AppState,op:Mutation,revision:number):AppState{
  const next=project(state,[op]);
  next.revision=revision;
  if(op.kind==='profile')next.profileRevision=revision;
  if(op.kind==='food')next.foodRevision=revision;
  if(op.kind==='entry'||op.kind==='day')next.diaryRevision=revision;
  if(['profile','entry','weight','day'].includes(op.kind))next.trajectoryRevision=revision;
  if(op.kind==='settings'){
    if(next.settings)next.settings={...next.settings,revision};
  }else if(op.kind!=='profile'){
    const key=({entry:'entries',food:'foods',weight:'weights',day:'days'} as const)[op.kind];
    const rows=next[key].map(row=>row.id===op.recordId?{...row,revision}:row);
    Object.assign(next,{[key]:rows});
    if(op.kind==='entry'){
      const dates=[(op.data as {date?:string}).date,state.entries.find(entry=>entry.id===op.recordId)?.date];
      next.days=next.days.map(day=>dates.includes(day.date)?{...day,revision}:day);
    }
  }
  return next;
}
