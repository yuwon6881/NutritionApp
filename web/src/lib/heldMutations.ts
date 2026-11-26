import type {Mutation} from '../types';
import {wireMutation} from './projection';

/**
 * Undoable operations. A held mutation is projected and persisted immediately
 * like any other queued work, but is not sent until `holdUntil`. Undo removes
 * it from the queue before it is sent, so nothing is deleted and re-created
 * and record ids never change. Holds survive a reload; an expired hold simply
 * dispatches on the next drain.
 */
export const UNDO_WINDOW_MS=5000;

/**
 * Queue order is dispatch order. A rejected edit is dropped rather than retained, so nothing blocks
 * the head. Queues saved by older builds may still carry a review marker; those edits simply retry.
 */
export function nextDispatchableMutation(queue:readonly Mutation[]):Mutation|undefined{
  return queue[0];
}

/** Milliseconds before the head of the queue may be sent; later work waits behind it to keep order. */
export function dispatchWait(queue:readonly Mutation[],now:number):number{
  const head=queue[0];
  return Math.max(0,(head?.holdUntil??0)-now,(head?.retryAt??0)-now);
}

/** Releases local undo holds immediately when the user dismisses Undo or leaves the app. */
export function releaseHeldMutations(queue:Mutation[],ids?:readonly string[]):Mutation[]{
  const wanted=ids?new Set(ids):undefined;
  let changed=false;
  const next=queue.map(op=>{
    if(op.holdUntil===undefined||(wanted&&!wanted.has(op.id)))return op;
    changed=true;
    const {holdUntil:_,...released}=op;
    return released;
  });
  return changed?next:queue;
}

/**
 * Selects the queue prefix safe to flush synchronously with fetch({ keepalive: true }) on hide.
 * Stops before any backoff wait, in-flight operation, or dependent mutation, and stays within
 * the browser's 64 KiB keepalive payload allowance.
 */
export function selectKeepaliveBatch(
  queue:readonly Mutation[],
  now:number,
  inFlightIds:ReadonlySet<string>,
  maxBytes=56_000,
  maxOps=10
):Mutation[]{
  const selected:Mutation[]=[];
  const seenRecords=new Set<string>();
  let totalBytes=0;
  for(const op of queue){
    if((op.retryAt??0)>now||inFlightIds.has(op.id))break;
    const bytes=new TextEncoder().encode(JSON.stringify(wireMutation(op))).length;
    if(bytes>maxBytes)break;
    if(selected.length===0){
      selected.push(op);
      seenRecords.add(op.recordId);
      totalBytes+=bytes;
      continue;
    }
    const first=selected[0];
    const firstIsCreate=first.expectedRevision===0&&!first.delete&&(first.kind==='entry'||first.kind==='food');
    const opIsCreate=op.expectedRevision===0&&!op.delete&&(op.kind==='entry'||op.kind==='food');
    if(!firstIsCreate||!opIsCreate||seenRecords.has(op.recordId))break;
    if(selected.length>=maxOps||totalBytes+bytes>maxBytes)break;
    selected.push(op);
    seenRecords.add(op.recordId);
    totalBytes+=bytes;
  }
  return selected;
}

export function undoHeldMutations(queue:Mutation[],ids:readonly string[],now:number):{queue:Mutation[];undone:string[]}{
  const wanted=new Set(ids);
  if(!wanted.size||wanted.size!==ids.length)return {queue,undone:[]};
  const selected=queue.filter(op=>wanted.has(op.id));
  if(selected.length!==wanted.size||selected.some(op=>op.holdUntil===undefined||op.holdUntil<=now))return {queue,undone:[]};
  // Later edits to a record depend on the projected operation remaining in order.
  for(const op of selected){
    if(queue.slice(queue.indexOf(op)+1).some(later=>!wanted.has(later.id)&&later.kind===op.kind&&later.recordId===op.recordId))return {queue,undone:[]};
  }
  return {queue:queue.filter(op=>!wanted.has(op.id)),undone:selected.map(op=>op.id)};
}
