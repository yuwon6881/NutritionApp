import type {Mutation} from '../types';

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
