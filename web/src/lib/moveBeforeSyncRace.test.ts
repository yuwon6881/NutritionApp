import {expect,it} from 'vitest';
import type {AppState,Entry,LocalData,Mutation} from '../types';
import {acknowledgeLocalWrite} from './nutritionAcknowledgement';
import {queueEntries} from './nutritionDrafts';
import {enqueueMutation,project} from './projection';
import {moveEntry} from './foodDiary';

const baseState:AppState={id:'a',displayName:'A',revision:0,profileRevision:0,profile:null,start:'2026-10-14',end:'2026-10-14',entries:[],foods:[],weights:[],days:[],plans:[]};

it('a bulk move issued before a just-logged batch finishes syncing still fully drains',()=>{
  let local:LocalData={state:baseState,queue:[]};

  // Four AI foods are logged together (queueEntries assigns fresh record ids), none acknowledged yet.
  const drafts=[0,1,2,3].map(i=>({name:`food-${i}`,date:'2026-10-14',time:'22:24',quantity:1,unit:'serving' as const,calories:100,protein:null,carbs:null,fat:null,fiber:null,source:'AI estimate'}));
  local={...local,queue:queueEntries(local,drafts)};
  const createOps=local.queue;
  expect(createOps).toHaveLength(4);

  // The UI renders the optimistic projection (what the diary page actually shows) and the user
  // immediately selects all four and moves them to the correct time, before any create is acked.
  const optimistic=project(local.state,local.queue).entries;
  expect(optimistic).toHaveLength(4);
  for(const entry of optimistic as Entry[]){
    const op=moveEntry(entry,'17:00',entry.date);
    expect(op).toBeDefined();
    local=enqueueMutation(local,{...op!,id:`move-${entry.id}`});
  }
  expect(local.queue).toHaveLength(8);

  // Drain processes the queue strictly in order: four creates, then four moves, each acknowledged
  // before the next is sent (mirrors useNutritionStore's drain loop).
  let revision=0;
  while(local.queue.length){
    const op=local.queue[0];
    revision+=1;
    local=acknowledgeLocalWrite(local,op,revision,{revision});
  }

  expect(local.queue).toHaveLength(0);
  const final=local.state.entries as Entry[];
  expect(final).toHaveLength(4);
  for(const entry of final){
    expect(entry.time).toBe('17:00');
  }
});
