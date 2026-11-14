import {describe,expect,it} from 'vitest';
import type {AcceptedTargetInterval,TrajectoryPoint} from '../types';
import {acceptedDailyCalories,coachingDays,knownRuns,targetGapLabel} from './coachingChart';

const point=(date:string,expenditure:number|null,suggestedCalories:number|null,revision=1):TrajectoryPoint=>
  ({date,revision,expenditure,suggestedCalories,confidence:1,holdReason:null,algorithmVersion:'test',trendWeightKg:null});
const plan=(start:string,end:string,calories:number|null,dailyCalories:number[]|null=null):AcceptedTargetInterval=>
  ({start,end,calories,weeklyCalories:null,dailyCalories});

describe('acceptedDailyCalories',()=>{
  it('prefers the stated daily figure and otherwise averages seven daily targets',()=>{
    expect(acceptedDailyCalories(plan('2026-10-01','2026-10-07',1900))).toBe(1900);
    expect(acceptedDailyCalories(plan('2026-10-01','2026-10-07',null,[1800,1800,1800,1800,1800,2150,2150]))).toBe(1900);
  });

  it('stays unknown without a full week of daily targets',()=>{
    expect(acceptedDailyCalories(plan('2026-10-01','2026-10-07',null,[1800,1800]))).toBeNull();
    expect(acceptedDailyCalories(plan('2026-10-01','2026-10-07',null))).toBeNull();
  });
});

describe('coachingDays',()=>{
  it('joins consecutive plans with no gap at their boundary',()=>{
    const days=coachingDays([],[plan('2026-10-01','2026-10-02',1900),plan('2026-10-03','2026-10-04',2430)],'2026-10-01','2026-10-04');
    expect(days.map(day=>day.target)).toEqual([1900,1900,2430,2430]);
  });

  it('lets a later plan supersede an earlier one on overlapping days',()=>{
    const days=coachingDays([],[plan('2026-10-01','2026-10-07',1900),plan('2026-10-03','2026-10-04',2430)],'2026-10-02','2026-10-04');
    expect(days.map(day=>day.target)).toEqual([1900,2430,2430]);
  });

  it('reads the newest revision and keeps missing figures unknown',()=>{
    const days=coachingDays([point('2026-10-02',2250,null,1),point('2026-10-02',2240,2450,2),point('2026-10-04',2230,null)],[],'2026-10-01','2026-10-04');
    expect(days).toEqual([
      {date:'2026-10-02',maintenance:2240,goal:2450,target:null},
      {date:'2026-10-03',maintenance:null,goal:null,target:null},
      {date:'2026-10-04',maintenance:2230,goal:null,target:null}
    ]);
  });

  it('starts at the range start when a plan began before it, and is empty without guidance',()=>{
    expect(coachingDays([],[plan('2026-09-01','2026-12-31',2000)],'2026-10-01','2026-10-02').map(day=>day.date)).toEqual(['2026-10-01','2026-10-02']);
    expect(coachingDays([point('2026-09-01',2200,null)],[],'2026-10-01','2026-10-02')).toEqual([]);
  });
});

describe('knownRuns',()=>{
  it('breaks runs across unknown values',()=>{
    expect(knownRuns([1,2,null,3,null,null,4,5])).toEqual([{from:0,to:1},{from:3,to:3},{from:6,to:7}]);
    expect(knownRuns([null,null])).toEqual([]);
  });
});

describe('targetGapLabel',()=>{
  const format=(value:number)=>value.toLocaleString('en-US');
  it('names a deficit or surplus in plain language',()=>{
    expect(targetGapLabel({maintenance:2250,target:1900},format,'kcal')).toBe('Target is 350 kcal/day below maintenance (a deficit)');
    expect(targetGapLabel({maintenance:2240,target:2430},format,'kcal')).toBe('Target is 190 kcal/day above maintenance (a surplus)');
    expect(targetGapLabel({maintenance:2240,target:2240.4},format,'kcal')).toBe('Target matches maintenance');
  });

  it('says nothing when either figure is unknown',()=>{
    expect(targetGapLabel({maintenance:null,target:1900},format,'kcal')).toBeNull();
    expect(targetGapLabel({maintenance:2250,target:null},format,'kcal')).toBeNull();
  });
});
