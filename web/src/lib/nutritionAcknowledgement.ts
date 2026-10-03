import type {LocalData,Mutation} from '../types';
import {acknowledgeState} from './acknowledgeState';
import {rebaseAfterOwnWrite} from './projection';

export function acknowledgeLocalWrite(current:LocalData,op:Mutation,revision:number):LocalData{
  const state=acknowledgeState(current.state,op,revision);
  let queue=rebaseAfterOwnWrite(current.queue,op,revision);
  if(op.kind==='entry'){
    const dates=[(op.data as {date?:string}).date,current.state.entries.find(entry=>entry.id===op.recordId)?.date];
    const dayIds=new Set(state.days.filter(day=>dates.includes(day.date)).map(day=>day.id));
    queue=queue.map(item=>item.kind==='day'&&dayIds.has(item.recordId)?{...item,expectedRevision:revision}:item);
  }
  const history=Object.fromEntries(Object.entries(current.history??{}).map(([key,saved])=>[key,acknowledgeState(saved,op,revision)]));
  return {...current,state,queue,history,foodsLoaded:op.kind==='food'?true:current.foodsLoaded};
}
