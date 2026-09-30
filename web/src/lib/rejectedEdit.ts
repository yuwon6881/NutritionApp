import type {Mutation} from '../types';

const statuses:Record<string,string>={complete:'Complete',fasting:'Fasting',incomplete:'Still logging',not_logged:'Not logging'};

function subjectOf(op:Mutation){
  const data=op.data&&typeof op.data==='object'?op.data as Record<string,unknown>:{};
  const date=typeof data.date==='string'?` for ${data.date}`:'';
  const name=typeof data.name==='string'&&data.name?` “${data.name}”`:'';
  if(op.kind==='day'){
    const status=typeof data.status==='string'?statuses[data.status]??data.status:'';
    return `${status?`“${status}” `:''}decision${date}`;
  }
  if(op.kind==='settings')return 'coaching settings change';
  if(op.kind==='profile')return 'coach profile change';
  if(op.kind==='weight')return `weigh-in${date}`;
  if(op.kind==='food')return `saved food${name}`;
  return `food entry${name}${date}`;
}

/**
 * The server keeps its saved record when it rejects a queued edit, so the device drops that edit
 * instead of holding it for review. This short notice keeps the outcome visible without blocking.
 */
export function rejectedEditMessage(op:Mutation){
  return `Couldn’t apply the ${subjectOf(op)} from this device. The saved version was kept.`;
}
