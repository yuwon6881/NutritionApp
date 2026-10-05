import {expect,it} from 'vitest';
import type {AppState,Mutation} from '../types';
import {acknowledgeLocalWrite} from './nutritionAcknowledgement';
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

it('uses the canonical saved decision instead of the requested decision',()=>{
  const state:AppState={id:'a',displayName:'A',revision:1,profileRevision:0,profile:null,start:'2026-01-01',end:'2026-01-02',entries:[],foods:[],weights:[],days:[],plans:[]};
  const op:Mutation={id:'op',kind:'day',recordId:'local',expectedRevision:0,delete:false,data:{date:'2026-01-01',status:'not_logged'}};
  const canonical={id:'saved',revision:1,deleted:false,date:'2026-01-01',status:'fasting' as const,archived:true,calories:0,entryCount:0};
  expect(acknowledgeLocalWrite({state,queue:[op]},op,2,{revision:2,days:[canonical]}).state.days).toEqual([canonical]);
});

it('rebases a move destination without replacing its source identity',()=>{
  const state:AppState={id:'a',displayName:'A',revision:1,profileRevision:0,profile:null,start:'2026-01-01',end:'2026-01-02',entries:[],foods:[],weights:[],days:[],plans:[]};
  const update:Mutation={id:'update',kind:'weight',recordId:'destination',expectedRevision:1,delete:false,data:{date:'2026-01-02',kg:81}};
  const move:Mutation={id:'move',kind:'weight_move',recordId:'source',expectedRevision:1,delete:false,data:{date:'2026-01-02',kg:82,destinationId:'destination',destinationRevision:1}};
  const saved={id:'destination',date:'2026-01-02',kg:81,revision:3,deleted:false};
  const next=acknowledgeLocalWrite({state,queue:[update,move]},update,3,{revision:3,weights:[saved]});
  expect(next.queue[0]).toMatchObject({recordId:'source',expectedRevision:1,data:{destinationId:'destination',destinationRevision:3}});
});

it('does not replace a newer weigh-in or settings with an older acknowledgement',()=>{
  const state:AppState={id:'a',displayName:'A',revision:5,profileRevision:0,profile:null,start:'2026-01-01',end:'2026-01-02',entries:[],foods:[],weights:[{id:'w',date:'2026-01-01',kg:82,revision:5,deleted:false}],days:[{id:'d',date:'2026-01-01',status:'complete',revision:5,deleted:false}],plans:[],settings:{checkInWeekday:5,revision:5}};
  const op:Mutation={id:'old',kind:'weight',recordId:'w',expectedRevision:1,delete:false,data:{date:'2026-01-01',kg:80}};
  const next=acknowledgeLocalWrite({state,queue:[op]},op,2,{revision:2,weights:[{id:'w',date:'2026-01-01',kg:80,revision:2,deleted:false}]});
  expect(next.state.weights[0]).toMatchObject({kg:82,revision:5});expect(next.state.revision).toBe(5);
  const dayOp:Mutation={...op,kind:'day',recordId:'d',data:{date:'2026-01-01',status:'not_logged'}};
  expect(acknowledgeLocalWrite({state,queue:[dayOp]},dayOp,2,{revision:2,days:[{id:'d',date:'2026-01-01',status:'not_logged',revision:2,deleted:false}]}).state.days[0]).toMatchObject({status:'complete',revision:5});
  expect(acknowledgeState(state,{...op,kind:'settings',recordId:'a',data:{checkInWeekday:1}},2).settings).toEqual(state.settings);
});
