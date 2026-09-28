import {expect,it} from 'vitest';
import type {AppState,Mutation} from '../types';
import {acknowledgeLocalWrite} from './nourishAcknowledgement';
import {acknowledgeState} from './acknowledgeState';

it('rebases day writes without mutating retained queue records or source days',()=>{
  const state:AppState={id:'a',displayName:'A',revision:1,profileRevision:0,profile:null,start:'2026-01-01',end:'2026-01-02',entries:[],foods:[],weights:[],days:[{id:'d',date:'2026-01-01',revision:1,deleted:false,status:'incomplete'}],plans:[]};
  const entry:Mutation={id:'entry',kind:'entry',recordId:'e',expectedRevision:0,delete:false,data:{date:'2026-01-01',calories:100}};
  const day:Mutation={id:'day',kind:'day',recordId:'d',expectedRevision:1,delete:false,data:{date:'2026-01-01',status:'complete'}};
  Object.freeze(day);Object.freeze(state.days[0]);
  const next=acknowledgeLocalWrite({state,queue:[entry,day]},entry,5);
  expect(next.queue[0].expectedRevision).toBe(5);
  expect(day.expectedRevision).toBe(1);
  expect(state.days[0].revision).toBe(1);
  expect(next.state.days[0].revision).toBe(5);
  expect(next.state.diaryRevision).toBe(5);
});

it('never mutates a shared archived record while acknowledging a delayed response',()=>{
  const entry={id:'e',date:'2026-01-01',revision:1,deleted:false,name:'Food',calories:100} as AppState['entries'][number];
  Object.freeze(entry);
  const state:AppState={id:'a',displayName:'A',revision:1,profileRevision:0,profile:null,start:'2026-01-01',end:'2026-01-02',entries:[entry],foods:[],weights:[],days:[{id:'d',date:'2026-01-01',revision:1,deleted:false,status:'complete',archived:true}],plans:[]};
  const next=acknowledgeState(state,{id:'m',kind:'entry',recordId:'e',expectedRevision:1,delete:false,data:{date:'2026-01-01',calories:200}},5);
  expect(entry.revision).toBe(1);
  expect(next.entries[0]).toMatchObject({revision:5,calories:100});
  expect(state.days[0].revision).toBe(1);
});
