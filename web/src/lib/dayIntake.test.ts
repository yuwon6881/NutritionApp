import {expect,it} from 'vitest';
import {calendarIntake} from './calendarProgress';
import {projectedDayIntakes} from './dayIntake';
import {historyState} from './history';
import type {AppState,LocalData,Mutation} from '../types';

const state={id:'a',revision:3,profile:{timeZone:'UTC'},start:'2026-03-01',end:'2026-03-31',
  entries:[{id:'e1',date:'2026-03-02',calories:300},{id:'e2',date:'2026-03-02',calories:200},
    {id:'e3',date:'2026-03-03',calories:400,deleted:true},{id:'e4',date:'2026-03-05',calories:150}],
  days:[{id:'d1',date:'2026-03-04',status:'fasting'},{id:'d2',date:'2026-03-06',archived:true,calories:1800}],
  weights:[],foods:[],plans:[]} as unknown as AppState;
const queue=[{id:'m',kind:'entry',recordId:'e4',expectedRevision:3,delete:false,data:{...state.entries[3],calories:650}}] as unknown as Mutation[];
const local={state,queue,history:{'2026-03-02':{...state,id:'other',revision:99}}} as unknown as LocalData;

it('matches the per-date projection for every date of the strip, one projection for all of them',()=>{
  const dates=['2026-02-27','2026-03-02','2026-03-03','2026-03-04','2026-03-05','2026-03-06','2026-04-02'];
  const expected=new Map(dates.map(date=>{
    const stored=historyState(local,date);
    return [date,calendarIntake(stored?{date,entries:stored.entries,day:stored.days[0],revision:stored.revision,fetchedAt:0}:undefined)];
  }));
  const intakes=projectedDayIntakes(local,dates);
  expect(intakes).toEqual(expected);
  expect([...intakes.values()]).toEqual([null,500,null,0,650,1800,null]);
});

it('reports nothing without local data',()=>{
  expect(projectedDayIntakes(undefined,['2026-03-02'])).toEqual(new Map([['2026-03-02',null]]));
});
