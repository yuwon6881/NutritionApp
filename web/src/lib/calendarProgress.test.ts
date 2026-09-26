import {describe,expect,it} from 'vitest';
import {calendarIntake,calendarTarget,calorieProgress} from './calendarProgress';
import type {AppState,DatedDiaryDay,Entry} from '../types';
import {DiaryCoordinator} from './diaryCoordinator';

const entry:Entry={id:'entry',revision:1,deleted:false,date:'2026-09-26',name:'Oats',source:'manual',calories:500,protein:null,carbs:null,fat:null,fiber:null,quantity:100,unit:'g'};
const day:DatedDiaryDay={date:entry.date,entries:[entry],revision:1,fetchedAt:0};

describe('calendar calorie progress',()=>{
  it('uses each historical interval and weekday target',()=>{
    const state={plans:[],acceptedTargetIntervals:[{start:'2026-09-21',end:'2026-09-27',calories:2000,weeklyCalories:14000,dailyCalories:[1800,1800,1800,1800,1800,2500,2500]}]} as unknown as AppState;
    expect(calendarTarget(state,'2026-09-25')).toBe(1800);
    expect(calendarTarget(state,'2026-09-26')).toBe(2500);
    expect(calendarTarget(state,'2026-09-20')).toBeNull();
  });
  it('clamps known intake and preserves unknown intake or targets',()=>{
    expect(calorieProgress(500,2000)).toBe(.25);
    expect(calorieProgress(2000,2000)).toBe(1);
    expect(calorieProgress(2500,2000)).toBe(1);
    expect(calorieProgress(0,2000)).toBe(0);
    expect(calorieProgress(null,2000)).toBeNull();
    expect(calorieProgress(500,null)).toBeNull();
    expect(calorieProgress(500,0)).toBeNull();
  });
  it('distinguishes no intake evidence, explicit fasting, and archived calories',()=>{
    expect(calendarIntake({...day,entries:[]})).toBeNull();
    expect(calendarIntake({...day,entries:[],day:{id:'day',date:entry.date,revision:1,deleted:false,status:'not_logged'}})).toBeNull();
    expect(calendarIntake({...day,entries:[],day:{id:'day',date:entry.date,revision:1,deleted:false,status:'fasting'}})).toBe(0);
    expect(calendarIntake({...day,day:{id:'day',date:entry.date,revision:1,deleted:false,status:'complete',archived:true,calories:1800}})).toBe(1800);
  });
  it('projects retained entry changes into progress without changing authoritative summaries',()=>{
    const coordinator=new DiaryCoordinator('calendar-user');
    coordinator.primeDays([day]);
    expect(calendarIntake(coordinator.projectDate(entry.date,[{id:'edit',kind:'entry',recordId:entry.id,expectedRevision:1,delete:false,data:{...entry,calories:1000}}]))).toBe(1000);
    expect(calendarIntake(coordinator.projectDate(entry.date,[{id:'delete',kind:'entry',recordId:entry.id,expectedRevision:1,delete:true,data:entry}]))).toBeNull();
  });
});
