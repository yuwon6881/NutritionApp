import {expect,it} from 'vitest';
import {automaticMissingDays,dayStatus,missingDays} from './loggingDay';
import type {AppState} from '../types';
it('leaves today open and completes past food logs',()=>{
  expect(dayStatus('2026-09-08','2026-09-08','complete',true)).toBe('incomplete');
  expect(dayStatus('2026-09-07','2026-09-08','incomplete',true)).toBe('complete');
  expect(dayStatus('2026-09-07','2026-09-08','not_logged',true)).toBe('not_logged');
  expect(dayStatus('2026-09-07','2026-09-08',undefined,false)).toBe('incomplete');
});
it('asks about weight-only days but never before first use or for resolved dates',()=>{
  const state={id:'u',username:'u',revision:0,profileRevision:0,foods:[],start:'2026-08-01',end:'2026-09-08',profile:null,entries:[],plans:[],weights:[{id:'w',revision:0,kg:80,date:'2026-09-05',deleted:false}],days:[{id:'d1',revision:0,date:'2026-09-06',status:'not_logged',deleted:false},{id:'d2',revision:0,date:'2026-09-07',status:'fasting',deleted:false}]} as AppState;
  expect(missingDays(state,'2026-09-08')).toEqual(['2026-09-05']);
});
it('does not let an automatic default overwrite an explicit open day',()=>{
  const state={id:'u',username:'u',revision:0,profileRevision:0,foods:[],start:'2026-08-01',end:'2026-09-08',profile:null,entries:[],plans:[],weights:[],days:[{id:'d1',revision:0,date:'2026-09-07',status:'incomplete',deleted:false}]} as AppState;
  expect(missingDays(state,'2026-09-08')).toEqual(['2026-09-07']);
  expect(automaticMissingDays(state,'2026-09-08','not_logged')).toEqual([]);
});
