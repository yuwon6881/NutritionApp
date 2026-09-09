import type { AppState, Mutation, Profile } from '../types';
const collection={entry:'entries',food:'foods',weight:'weights',day:'days'} as const;
export function project(state:AppState,queue:Mutation[]):AppState{
  const result=structuredClone(state);
  for(const op of queue){
    if(op.kind==='profile'){result.profile=op.data as Profile;continue;}
    if(op.kind==='entry'){
      const dates=[(op.data as {date?:string}).date,result.entries.find(e=>e.id===op.recordId)?.date];
      // Keep expired/conflicting work in the queue, without changing an authoritative summary.
      if(result.days.some(day=>day.archived&&dates.includes(day.date)))continue;
    }
    const key=collection[op.kind];
    const values=result[key] as Array<{id:string;revision:number;deleted:boolean;date?:string;status?:string}>;
    const i=values.findIndex(v=>v.id===op.recordId);
    const old=values[i];const next={...(op.kind==='day'?old:{}),...(op.delete?old:op.data as object),id:op.recordId,revision:op.expectedRevision,deleted:op.delete};
    if(i<0)values.push(next);else values[i]=next;
    if(op.kind==='entry')for(const d of result.days)if(d.date===(next as {date?:string}).date||d.date===old?.date)d.status='incomplete';
  }
  result.entries.sort((a,b)=>a.date.localeCompare(b.date)||a.id.localeCompare(b.id));
  result.weights.sort((a,b)=>a.date.localeCompare(b.date));result.foods.sort((a,b)=>a.name.localeCompare(b.name));
  return result;
}
export function wireMutation(op:Mutation){const {error:_,...wire}=op;return wire;}
export function rebaseAfterOwnWrite(queue:Mutation[],completed:Mutation,revision:number):Mutation[]{
  return queue.filter(q=>q.id!==completed.id).map(q=>q.kind===completed.kind&&q.recordId===completed.recordId?{...q,expectedRevision:revision}:q);
}
