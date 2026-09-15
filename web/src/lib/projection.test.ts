import {describe,it,expect} from 'vitest';
import {project,rebaseAfterOwnWrite,wireMutation} from './projection';
import {trend} from './format';
import type {AppState,Mutation} from '../types';
const state:AppState={id:'a',displayName:'a',revision:1,profileRevision:0,profile:null,start:'2026-01-01',end:'2026-03-01',entries:[],foods:[],weights:[],days:[{id:'d',revision:1,deleted:false,date:'2026-02-01',status:'complete'}],plans:[]};
describe('offline projection',()=>{
it('marks edited days incomplete before sync and preserves unknown nutrients',()=>{const op:Mutation={id:'m',kind:'entry',recordId:'e',expectedRevision:0,delete:false,data:{date:'2026-02-01',name:'Rice',calories:130,protein:null}};const result=project(state,[op]);expect(result.days[0].status).toBe('incomplete');expect(result.entries[0].protein).toBeNull();expect(state.days[0].status).toBe('complete');});
it('rebases only subsequent writes to the same record',()=>{const op:Mutation={id:'m',kind:'weight',recordId:'w',expectedRevision:0,delete:false,data:{}};const queue=[op,{...op,id:'n'},{...op,id:'o',recordId:'other',expectedRevision:3}];expect(rebaseAfterOwnWrite(queue,op,5).map(q=>q.expectedRevision)).toEqual([5,3]);});
it('keeps a settings change coalesced during its in-flight write',()=>{
  const sent:Mutation={id:'settings',kind:'settings',recordId:'a',expectedRevision:4,delete:false,data:{checkInWeekday:1,weightUnit:'kg'}};
  const coalesced={...sent,data:{checkInWeekday:1,weightUnit:'lb'}};
  const remaining=rebaseAfterOwnWrite([coalesced],sent,5,()=>'00000000-0000-0000-0000-000000000001');
  expect(remaining).toEqual([{...coalesced,id:'00000000-0000-0000-0000-000000000001',expectedRevision:5}]);
});
it('never sends local error metadata as mutation content',()=>{const op:Mutation={id:'m',kind:'day',recordId:'d',expectedRevision:1,delete:false,data:{},error:'conflict'};expect(wireMutation(op)).not.toHaveProperty('error');});
it('projects cadence edits without changing the active profile revision',()=>{
  const withPlan={...state,profileRevision:7,settings:{checkInWeekday:1,revision:4}};
  const op:Mutation={id:'settings',kind:'settings',recordId:'a',expectedRevision:4,delete:false,data:{checkInWeekday:5,missingDayAction:'fasting'}};
  const result=project(withPlan,[op]);
  expect(result.settings).toEqual({checkInWeekday:5,revision:4,missingDayAction:'fasting'});
  expect(result.profileRevision).toBe(7);
  expect(result.plans).toEqual(withPlan.plans);
});
it('matches time-aware seven-day smoothing',()=>expect(trend([{date:'2026-01-01',kg:80},{date:'2026-01-08',kg:82}])[1].kg).toBe(81));
});

it('preserves archived totals when a day decision is queued',()=>{
  const archived={...state,days:[{...state.days[0],archived:true,calories:1700,entryCount:3,protein:null}]};
  const op:Mutation={id:'decision',kind:'day',recordId:'d',expectedRevision:1,delete:false,data:{date:'2026-02-01',status:'not_logged'}};
  const day=project(archived,[op]).days[0];
  expect(day.status).toBe('not_logged');expect(day.archived).toBe(true);expect(day.calories).toBe(1700);expect(day.protein).toBeNull();
});
