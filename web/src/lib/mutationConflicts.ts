import type {LocalData,Mutation,MutationConflict} from '../types';

const legacyConflictMessage='This saved change needs review before it can be sent.';

function conflictDate(mutation:Mutation):string|null{
  const date=(mutation.data as {date?:unknown}|null)?.date;
  return typeof date==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(date)?date:null;
}

export function createMutationConflict(mutation:Mutation,message:string,createdAt:number):MutationConflict{
  const {error:_legacy,...saved}=mutation as Mutation&{error?:string};
  return {id:mutation.id,mutation:saved,message,date:conflictDate(mutation),createdAt};
}

export function retainMutationConflict(local:LocalData,failed:Mutation,message:string,createdAt:number):LocalData{
  const mutation=local.queue.find(item=>item.id===failed.id)??failed;
  const queue=local.queue.filter(item=>item.id!==failed.id);
  if(local.conflicts?.some(conflict=>conflict.id===mutation.id))return queue.length===local.queue.length?local:{...local,queue};
  return {...local,queue,conflicts:[...(local.conflicts??[]),createMutationConflict(mutation,message,createdAt)]};
}

export function extractLegacyMutationConflicts(queue:Mutation[],conflicts:MutationConflict[],createdAt:number){
  const existing=new Set(conflicts.map(conflict=>conflict.id));
  const pending:Mutation[]=[];
  const next=[...conflicts];
  let moved=0;
  for(const mutation of queue){
    const error=(mutation as Mutation&{error?:unknown}).error;
    if(typeof error!=='string'||!error.toLowerCase().includes('conflict')){pending.push(mutation);continue;}
    moved++;
    if(!existing.has(mutation.id)){
      next.push(createMutationConflict(mutation,legacyConflictMessage,createdAt));
      existing.add(mutation.id);
    }
  }
  return {queue:pending,conflicts:next,moved};
}

export function indexConflictsByDate(conflicts:readonly MutationConflict[]):[string,MutationConflict[]][]{
  const grouped=new Map<string,MutationConflict[]>();
  for(const conflict of conflicts){
    const key=conflict.date??'undated';
    const entries=grouped.get(key);
    if(entries)entries.push(conflict);else grouped.set(key,[conflict]);
  }
  return [...grouped.entries()].sort(([left],[right])=>right.localeCompare(left));
}

export function resolveMutationConflicts(local:LocalData,ids:readonly string[]):LocalData{
  const conflicts=local.conflicts??[];
  if(!conflicts.length||!ids.length)return local;
  const selected=new Set(ids);
  const remaining=conflicts.filter(conflict=>!selected.has(conflict.id));
  return remaining.length===conflicts.length?local:{...local,conflicts:remaining};
}