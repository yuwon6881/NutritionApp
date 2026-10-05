import type {LocalData,Mutation,SyncAcknowledgement,AppState} from '../types';
import {acknowledgeState} from './acknowledgeState';
import {rebaseAfterOwnWrite} from './projection';

function canonicalState(state:AppState,canonical:SyncAcknowledgement|undefined,previous:AppState):AppState{
  // Compare with confirmed state before the optimistic acknowledgement stamps its revision.
  const next={...state};
  const days=canonical?.days?.filter(saved=>!previous.days.some(row=>row.date===saved.date&&row.revision>saved.revision));
  const weights=canonical?.weights?.filter(saved=>!previous.weights.some(row=>(row.id===saved.id||row.date===saved.date)&&row.revision>saved.revision));
  if(days)next.days=[...state.days.filter(row=>!days.some(saved=>saved.date===row.date)),...days];
  if(weights)next.weights=[...state.weights.filter(row=>!weights.some(saved=>saved.id===row.id||saved.date===row.date)),...weights];
  return next;
}
export function acknowledgeLocalWrite(current:LocalData,op:Mutation,revision:number,canonical?:SyncAcknowledgement):LocalData{
  const state=canonicalState(acknowledgeState(current.state,op,revision),canonical,current.state);
  let queue=rebaseAfterOwnWrite(current.queue,op,revision);
  if(op.kind==='entry'){
    const dates=[(op.data as {date?:string}).date,current.state.entries.find(entry=>entry.id===op.recordId)?.date];
    const dayIds=new Set(state.days.filter(day=>dates.includes(day.date)).map(day=>day.id));
    queue=queue.map(item=>item.kind==='day'&&dayIds.has(item.recordId)?{...item,expectedRevision:revision}:item);
  }
  if(canonical?.days)queue=queue.map(item=>{
    if(item.kind!=='day')return item;
    const saved=canonical.days!.find(row=>row.date===(item.data as {date?:string}).date);
    return saved?{...item,recordId:saved.id,expectedRevision:saved.revision}:item;
  });
  if(canonical?.weights)queue=queue.map(item=>{
    if(item.kind!=='weight'&&item.kind!=='weight_move')return item;
    const date=(item.data as {date?:string}).date;
    if(item.kind==='weight_move'){
      const source=canonical.weights!.find(row=>row.id===item.recordId)
        ??(op.kind==='weight'&&item.recordId===op.recordId?canonical.weights!.find(row=>row.date===(op.data as {date?:string}).date):undefined);
      const destination=canonical.weights!.find(row=>row.date===date&&row.id!==(source?.id??item.recordId));
      return {...item,recordId:source?.id??item.recordId,expectedRevision:source?.revision??item.expectedRevision,
        data:{...(item.data as object),...(destination?{destinationId:destination.id,destinationRevision:destination.revision}:{})}};
    }
    const saved=canonical.weights!.find(row=>row.id===item.recordId)||canonical.weights!.find(row=>row.date===date);
    return saved?{...item,recordId:saved.id,expectedRevision:saved.revision}:item;
  });
  const history=Object.fromEntries(Object.entries(current.history??{}).map(([key,saved])=>[key,canonicalState(acknowledgeState(saved,op,revision),canonical,saved)]));
  return {...current,state,queue,history,foodsLoaded:op.kind==='food'?true:current.foodsLoaded};
}
