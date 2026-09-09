import {expect,it} from 'vitest';
import {liveGoalProgress,mergeGoalProgress} from './goalProgress';
import type {Profile} from '../types';
const profile=(extra:Partial<Profile>={}):Profile=>({age:30,dateOfBirth:null,heightCm:175,weightKg:80,sex:'male',activity:1.4,goal:'lose',
  maintenance:2500,proteinGrams:null,resistanceTraining:false,pregnancyOrBreastfeeding:false,medicalNutrition:false,
  timeZone:'Asia/Kuala_Lumpur',phaseMode:'weight',targetWeightKg:75,phaseStartWeightKg:80,...extra});
const flat=(kg:number)=>Array.from({length:28},(_,i)=>({date:new Date(Date.parse('2026-09-08')-(27-i)*86400000).toISOString().slice(0,10),kg}));

it('reports percentage of the weight change from the starting position',()=>{
  const progress=liveGoalProgress(profile(),flat(77.5),'2026-09-08')!;
  expect(progress.percent).toBeCloseTo(50,3);
  expect(progress.startWeight).toBe(80);
  expect(progress.targetWeight).toBe(75);
  expect(progress.remaining).toBeCloseTo(2.5,3);
  expect(progress.complete).toBe(false);
});
it('reaches a gain goal from the other direction',()=>{
  const progress=liveGoalProgress(profile({goal:'gain',targetWeightKg:85}),flat(82),'2026-09-08')!;
  expect(progress.percent).toBeCloseTo(40,3);
  expect(progress.remaining).toBeCloseTo(3,3);
});
it('reports reached milestones without completing the phase',()=>{
  const reached=liveGoalProgress(profile(),flat(74),'2026-09-08')!;
  expect(reached.complete).toBe(false);expect(reached.trendReached).toBe(true);expect(reached.scaleReached).toBe(true);
  const oneLowReading=[...flat(80).slice(0,-1),{date:'2026-09-08',kg:74}];
  expect(liveGoalProgress(profile(),oneLowReading,'2026-09-08')!.complete).toBe(false);
  expect(liveGoalProgress(profile(),oneLowReading,'2026-09-08')!.scaleReached).toBe(true);
  const stale=flat(74).map(w=>({...w,date:new Date(Date.parse(w.date)-30*86400000).toISOString().slice(0,10)}));
  expect(liveGoalProgress(profile(),stale,'2026-09-08')!.trendReached).toBe(false);
});
it('measures elapsed time for a duration phase and nothing for an open phase',()=>{
  const duration=liveGoalProgress(profile({phaseMode:'duration',phaseStart:'2026-08-11',durationWeeks:4}),[],'2026-09-08')!;
  expect(duration.percent).toBeCloseTo(100,3);
  expect(duration.complete).toBe(false);expect(duration.durationReached).toBe(true);
  const open=liveGoalProgress(profile({phaseMode:'open',targetWeightKg:null}),flat(80),'2026-09-08')!;
  expect(open.percent).toBeNull();
  expect(open.targetWeight).toBeNull();
  expect(open.startWeight).toBe(80);
});
it('keeps completion explicit when merging a reached live phase',()=>{
  const accepted=liveGoalProgress(profile(),flat(80),'2026-09-08')!;
  const reached=liveGoalProgress(profile(),flat(74),'2026-09-08')!;
  const merged=mergeGoalProgress(accepted,reached);
  expect(merged?.scaleReached).toBe(true);
  expect(merged?.trendReached).toBe(true);
  expect(merged?.complete).toBe(false);
  expect(mergeGoalProgress(accepted,reached,{id:'phase',revision:1,deleted:false,date:'2026-09-08',profileRevision:1,reachedBy:'trend',decision:'completed'})?.complete).toBe(true);
});
