import {afterEach,expect,it,vi} from 'vitest';
import type {AppState,Entry,LocalData,Mutation} from '../types';
import {mealReadOnly,mealTime,timelineGroups} from './foodDiary';
import {acknowledgeHistory,historyState} from './history';

const state:AppState={id:'a',username:'a',revision:1,profileRevision:0,profile:null,start:'2026-06-12',end:'2026-09-09',entries:[],foods:[],weights:[],days:[],plans:[],detailDays:90};
const entry=(id:string,time?:string|null):Entry=>({id,time,date:'2026-09-09',name:'Quick add',meal:'Meal',quantity:1,unit:'serving',calories:300,protein:null,carbs:null,fat:null,fiber:null,source:'Quick add',revision:0,deleted:false});
afterEach(()=>vi.useRealTimers());

it('starts at midnight, orders occupied times, and separates legacy entries',()=>{
  const groups=timelineGroups([entry('late','23:59'),entry('old'),entry('noon','12:00'),entry('midnight','00:00')]);
  expect(groups.map(g=>g.label)).toEqual(['12 AM','12 PM','11:59 PM','Time not recorded']);
  expect(groups.map(g=>g.entries[0].id)).toEqual(['midnight','noon','late','old']);
});
it('uses the profile time zone and keeps already archived days read-only',()=>{
  vi.useFakeTimers();vi.setSystemTime(new Date('2026-09-08T16:05:00Z'));
  expect(mealTime('Asia/Kuala_Lumpur')).toBe('00:05');
  expect(mealReadOnly(state,'2026-06-12')).toBe(false);
  expect(mealReadOnly(state,'2026-06-11')).toBe(true);
  expect(mealReadOnly({...state,days:[{id:'d',date:'2026-09-01',archived:true,status:'complete',revision:1,deleted:false}]},'2026-09-01')).toBe(true);
});
it('projects retained quick adds into cached days without replacing the main window',()=>{
  const food=entry('e','09:00');
  const op:Mutation={id:'m',recordId:'e',kind:'entry',expectedRevision:0,delete:false,data:food};
  const local:LocalData={state,queue:[op],scans:[]};
  const selected=historyState(local,'2026-09-09')!;
  expect(selected.entries).toEqual([food]);expect(selected.start).toBe('2026-09-09');
  expect(state.entries).toEqual([]);expect(state.start).toBe('2026-06-12');
  const saved=acknowledgeHistory(state,op,2);
  expect(saved.entries[0].revision).toBe(2);expect(saved.entries[0].protein).toBeNull();
  expect(saved.entries[0].time).toBe('09:00');
});
it('distinguishes missing cache coverage and rejects another account cache',()=>{
  const local:LocalData={state,queue:[],scans:[],history:{'2025':{...state,id:'other',start:'2025-01-01',end:'2025-12-31'}}};
  expect(historyState(local,'2025')).toBeUndefined();
  expect(historyState(local,'2026-09-09')?.entries).toEqual([]);
});
it('selects fresher covered history and retains archived unknown totals',()=>{
  const archived:AppState={...state,revision:2,days:[{id:'d',date:'2026-09-01',archived:true,calories:450,protein:null,entryCount:1,status:'complete',revision:2,deleted:false}]};
  const local:LocalData={state,queue:[],scans:[],history:{recent:archived}};
  const selected=historyState(local,'2026-09-01')!;
  expect(selected.days[0].calories).toBe(450);expect(selected.days[0].protein).toBeNull();
});
it('retains a conflicting meal edit without projecting it over an archived summary',()=>{
  const archived:AppState={...state,days:[{id:'d',date:'2026-09-09',archived:true,calories:450,entryCount:1,status:'not_logged',revision:2,deleted:false}]};
  const op:Mutation={id:'m',recordId:'e',kind:'entry',expectedRevision:0,delete:false,data:entry('e','12:00'),error:'Already summarized'};
  const local:LocalData={state:archived,queue:[op],scans:[]};
  const selected=historyState(local,'2026-09-09')!;
  expect(selected.entries).toEqual([]);expect(selected.days[0].status).toBe('not_logged');
  expect(selected.days[0].calories).toBe(450);expect(local.queue).toEqual([op]);
});
