import type {Mutation} from '../types';

/**
 * Undoable deletions. A held mutation is projected and persisted immediately
 * like any other queued work, but is not sent until `holdUntil`. Undo removes
 * it from the queue before it is sent, so nothing is deleted and re-created
 * and record ids never change. Holds survive a reload; an expired hold simply
 * dispatches on the next drain.
 */
export const UNDO_WINDOW_MS=5000;

/** Conflicts stay retained; neither they nor later edits to their protected record dispatch. */
export function nextDispatchableMutation(queue:readonly Mutation[]):Mutation|undefined{
  const blocked=new Set(queue.filter(op=>op.error).map(op=>`${op.kind}:${op.recordId}`));
  return queue.find(op=>!op.error&&!blocked.has(`${op.kind}:${op.recordId}`));
}

/** Milliseconds before the head of the queue may be sent; later work waits behind it to keep order. */
export function dispatchWait(queue:readonly Mutation[],now:number):number{
  const head=queue[0];
  return head?.holdUntil&&head.holdUntil>now?head.holdUntil-now:0;
}

export function undoHeldMutations(queue:Mutation[],ids:readonly string[],now:number):{queue:Mutation[];undone:string[]}{
  const wanted=new Set(ids);
  const undone=queue.filter(op=>wanted.has(op.id)&&op.holdUntil!==undefined&&op.holdUntil>now).map(op=>op.id);
  if(!undone.length)return {queue,undone};
  const removed=new Set(undone);
  return {queue:queue.filter(op=>!removed.has(op.id)),undone};
}
