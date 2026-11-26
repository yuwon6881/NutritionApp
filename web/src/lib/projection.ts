import type { AppState, CoachingSettings, LocalData, Mutation, Profile } from '../types';
const collection={entry:'entries',food:'foods',weight:'weights',day:'days'} as const;
function knownRecordRevision(current:LocalData,kind:Mutation['kind'],recordId:string):number|undefined{
  if(kind==='settings')return current.state.settings?.revision;
  if(kind==='profile')return current.state.profileRevision;
  const key=collection[(kind==='weight_move'?'weight':kind) as keyof typeof collection];
  return key?(current.state[key] as Array<{id:string;revision:number}>).find(item=>item.id===recordId)?.revision:undefined;
}
export function enqueueMutation(current:LocalData,op:Mutation):LocalData{
  if(op.kind==='settings'){
    // A settings operation that already failed after dispatch (retryAt) may have reached the server
    // under its idempotency key; merging new data into it would replay that key with a different body.
    const queued=[...current.queue].reverse().find(item=>item.kind==='settings');
    if(queued&&queued.retryAt===undefined)return {...current,queue:current.queue.map(item=>item.id===queued.id?{...item,data:{...(item.data as object),...(op.data as object)}}:item)};
    // A control can change again before React receives the preceding acknowledgement.
    const expectedRevision=current.state.settings?.revision??op.expectedRevision;
    return {...current,queue:[...current.queue,{...op,expectedRevision}]};
  }
  // A record can change again before React receives the preceding acknowledgement.
  const known=knownRecordRevision(current,op.kind,op.recordId);
  const expectedRevision=known!==undefined?Math.max(op.expectedRevision,known):op.expectedRevision;
  return {...current,queue:[...current.queue,{...op,expectedRevision}]};
}
export function project(state:AppState,queue:Mutation[]):AppState{
  if(queue.length===0)return state;
  const result={...state};
  const copied=new Set<'entries'|'foods'|'weights'|'days'>();
  const copy=(key:'entries'|'foods'|'weights'|'days')=>{
    if(copied.has(key))return;
    Object.assign(result,{[key]:[...result[key]]});
    copied.add(key);
  };
  for(const op of queue){
    if(op.kind==='profile'){result.profile=op.data as Profile;continue;}
    if(op.kind==='settings'){
      const settings=op.data as Partial<CoachingSettings>;
      result.settings={...(result.settings??{checkInWeekday:1,revision:0}),...settings};
      continue;
    }
    if(op.kind==='weight_move'){
      copy('weights');
      const data=op.data as {date:string;kg:number;context?:import('../types').WeightContextCode|null;destinationId?:string|null};
      const source=result.weights.find(w=>w.id===op.recordId);
      const target=result.weights.find(w=>w.date===data.date&&w.id!==op.recordId);
      const moved={...(target??source),...data,id:target?.id??data.destinationId??op.recordId,
        revision:target?.revision??source?.revision??op.expectedRevision,deleted:false,source:'manual' as const};
      result.weights=result.weights.map(w=>w.id===moved.id?moved:w.id===op.recordId?{...w,deleted:true}:w);
      if(!result.weights.some(w=>w.id===moved.id))result.weights.push(moved);
      continue;
    }
    const key=collection[op.kind];
    copy(key);
    const values=result[key] as Array<{id:string;revision:number;deleted:boolean;date?:string;status?:string}>;
    const i=values.findIndex(v=>v.id===op.recordId);
    // A delete for a record this state does not hold (another history window, or removed by another
    // device) has nothing to hide; adding a placeholder would leave a row with no date or name.
    if(i<0&&op.delete)continue;
    const old=values[i];const next={...(op.kind==='day'?old:{}),...(op.delete?old:op.data as object),id:op.recordId,revision:op.expectedRevision,deleted:op.delete};
    if(i<0)values.push(next);else values[i]=next;
    if(op.kind==='entry'){
      const changed=result.days.some(d=>d.date===(next as {date?:string}).date||d.date===old?.date);
      if(changed){
        copy('days');
        result.days=result.days.map(d=>d.date===(next as {date?:string}).date||d.date===old?.date?{...d,status:'incomplete'}:d);
      }
    }
  }
  if(copied.has('entries'))result.entries.sort((a,b)=>a.date.localeCompare(b.date)||a.id.localeCompare(b.id));
  if(copied.has('weights'))result.weights.sort((a,b)=>a.date.localeCompare(b.date));
  if(copied.has('foods'))result.foods.sort((a,b)=>a.name.localeCompare(b.name));
  return result;
}
// Queues saved before rejected edits were dropped may still carry a legacy review marker.
export function wireMutation(op:Mutation){const {error:_legacy,holdUntil:_hold,retryAt:_retry,...wire}=op as Mutation&{error?:string};return wire;}
/** Preserve settings changed during a request while retiring the rejected payload. */
export function retireRejectedMutation(queue:Mutation[],sent:Mutation):Mutation[]{
  return queue.flatMap(item=>{
    if(item.id!==sent.id)return [item];
    if(item.kind!=='settings')return [];
    const sentSettings=sent.data as Record<string,unknown>;
    const changes=Object.fromEntries(Object.entries(item.data as object).filter(([key,value])=>!Object.is(sentSettings[key],value)));
    return Object.keys(changes).length?[{...item,id:crypto.randomUUID(),data:changes}]:[];
  });
}

/** Marks a sent operation for retry. Data coalesced into it while in flight becomes its own operation, so a retry replays exactly what was sent. */
export function markForRetry(queue:Mutation[],sent:Mutation,retryAt:number,newId:()=>string=()=>crypto.randomUUID()):Mutation[]{
  return queue.flatMap(item=>{
    if(item.id!==sent.id)return [item];
    if(JSON.stringify(wireMutation(item))===JSON.stringify(wireMutation(sent)))return [{...item,retryAt}];
    return [{...sent,retryAt},{...item,id:newId(),retryAt:undefined}];
  });
}
export function rebaseAfterOwnWrite(queue:Mutation[],completed:Mutation,revision:number,newId=()=>crypto.randomUUID()):Mutation[]{
  // A settings edit can be coalesced while its request is in flight. The
  // queued object then has the same id but newer data; keep it as a fresh
  // idempotent operation rebased on the revision just returned.
  const remaining=queue.flatMap(q=>{
    if(q.id!==completed.id)return [q];
    return JSON.stringify(wireMutation(q))===JSON.stringify(wireMutation(completed))?[]:[{...q,id:newId(),expectedRevision:revision}];
  });
  const weightWrite=completed.kind==='weight'||completed.kind==='weight_move';
  const completedDestination=completed.kind==='weight_move'?(completed.data as {destinationId?:string}).destinationId:undefined;
  return remaining.map(q=>{
    if(!weightWrite||(q.kind!=='weight'&&q.kind!=='weight_move'))
      return q.kind===completed.kind&&q.recordId===completed.recordId?{...q,expectedRevision:revision}:q;
    const changed=(id:string|undefined)=>id!=null&&(id===completed.recordId||id===completedDestination);
    const next=changed(q.recordId)?{...q,expectedRevision:revision}:q;
    if(q.kind!=='weight_move')return next;
    const move=q.data as {destinationId?:string};
    return changed(move.destinationId)?{...next,data:{...move,destinationRevision:revision}}:next;
  });
}
