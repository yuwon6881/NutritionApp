import {describe,expect,it} from 'vitest';
import type {AppState,LocalData,Mutation} from '../types';
import {extractLegacyMutationConflicts,indexConflictsByDate,resolveMutationConflicts,retainMutationConflict} from './mutationConflicts';

const state:AppState={id:'a',displayName:'A',revision:1,profileRevision:0,profile:null,start:'2026-01-01',end:'2026-01-02',entries:[],foods:[],weights:[],days:[],plans:[]};
const mutation=(id:string,date:string):Mutation=>({id,kind:'weight',recordId:`weight-${id}`,expectedRevision:1,delete:false,data:{date,kg:81}});

describe('retained mutation conflicts',()=>{
  it('moves a failed mutation out of dispatch without changing its payload or later queue order',()=>{
    const failed=mutation('failed','2026-01-02');
    const later=mutation('later','2026-01-03');
    const local:LocalData={state,queue:[failed,later]};
    const next=retainMutationConflict(local,failed,'The record changed.',10);
    expect(next.queue).toEqual([later]);
    expect(next.conflicts).toEqual([{id:'failed',mutation:failed,message:'The record changed.',date:'2026-01-02',createdAt:10}]);
  });

  it('migrates only legacy conflict markers and keeps other rejected markers dispatchable',()=>{
    const conflict={...mutation('old-conflict','2026-01-01'),error:'Retained conflict'} as Mutation;
    const rejected={...mutation('old-rejection','2026-01-02'),error:'Invalid data (400)'} as Mutation;
    const result=extractLegacyMutationConflicts([conflict,rejected],[],10);
    expect(result.queue).toEqual([rejected]);
    expect(result.conflicts.map(item=>item.id)).toEqual(['old-conflict']);
    expect(result.conflicts[0].mutation).not.toHaveProperty('error');
    expect(result.moved).toBe(1);
  });

  it('indexes only when requested and resolves selected conflicts without touching other work',()=>{
    const local=retainMutationConflict({state,queue:[]},mutation('one','2026-01-02'),'Conflict',1);
    const withTwo=retainMutationConflict(local,mutation('two','2026-01-02'),'Conflict',2);
    const withUndated=retainMutationConflict(withTwo,{...mutation('three','2026-01-03'),data:{}},'Conflict',3);
    expect(indexConflictsByDate(withUndated.conflicts??[]).map(([date,items])=>[date,items.length])).toEqual([['undated',1],['2026-01-02',2]]);
    const resolved=resolveMutationConflicts(withUndated,['one','two']);
    expect(resolved.conflicts?.map(item=>item.id)).toEqual(['three']);
    expect(resolved.queue).toEqual([]);
  });
});