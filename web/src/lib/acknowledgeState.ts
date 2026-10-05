import type {AppState,Mutation} from '../types';
import {project} from './projection';

/** Acknowledgement may touch an archived record that projection deliberately left shared. */
export function acknowledgeState(state:AppState,op:Mutation,revision:number):AppState{
  const key=({entry:'entries',food:'foods',weight:'weights',weight_move:'weights',day:'days'} as const);
  const moveRevision=op.kind==='weight_move'?Math.max(0,...state.weights
    .filter(row=>row.id===op.recordId||row.date===(op.data as {date?:string}).date).map(row=>row.revision)):0;
  const known=op.kind==='profile'?state.profileRevision:op.kind==='settings'?state.settings?.revision:
    state[key[op.kind]].find(row=>row.id===op.recordId)?.revision;
  if(Math.max(known??0,moveRevision)>revision)return {...state};
  const next=project(state,[op]);
  next.revision=Math.max(state.revision,revision);
  if(op.kind==='profile')next.profileRevision=Math.max(state.profileRevision,revision);
  if(op.kind==='food')next.foodRevision=Math.max(state.foodRevision??0,revision);
  if(op.kind==='entry'||op.kind==='day')next.diaryRevision=Math.max(state.diaryRevision??0,revision);
  if(['profile','entry','weight','weight_move','day'].includes(op.kind))next.trajectoryRevision=Math.max(state.trajectoryRevision??0,revision);
  if(op.kind==='settings'){
    if(next.settings)next.settings={...next.settings,revision};
  }else if(op.kind==='weight_move'){
    next.weights=next.weights.map(row=>row.id===op.recordId||row.date===(op.data as {date:string}).date?{...row,revision}:row);
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
