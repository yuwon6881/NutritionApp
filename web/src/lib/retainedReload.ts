import type {LocalData} from '../types';
import {readDrafts,readLocal,readMutations} from './local';

export type RetainedPartition='queue'|'drafts';

/** Re-reads the retained work a dispatcher is about to send. Another tab may have queued or
 * finished work without its broadcast arriving, so the durable partition is always read. The
 * full account snapshot is read only when that partition differs from memory: an idle wake then
 * keeps the current object and causes no app-wide re-render. A stale account copy cannot clobber
 * a newer one, because the snapshot writer refuses to lower the persisted revision. */
export async function reloadRetainedWork(user:string,current:LocalData|null|undefined,partition:RetainedPartition):Promise<LocalData|undefined>{
  if(!current)return readLocal(user);
  if(partition==='queue'){
    const queue=await readMutations(user);
    if(JSON.stringify(queue)===JSON.stringify(current.queue))return current;
  }else{
    // Drafts can hold multi-megabyte images: only the empty case is compared, never their content.
    const drafts=await readDrafts(user);
    const empty=!drafts.photoDrafts?.length&&!drafts.bodyDrafts?.length;
    if(empty&&!current.photoDrafts?.length&&!current.bodyDrafts?.length)return current;
  }
  return readLocal(user);
}
