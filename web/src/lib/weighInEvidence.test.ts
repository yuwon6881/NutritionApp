import {describe,expect,it} from 'vitest';
import type {Day,Entry} from '../types';
import {contextAdjustmentSummary,recentIntake} from './weighInEvidence';

const entry=(date:string,calories:number):Entry=>({id:`${date}-${calories}`,revision:1,deleted:false,date,calories,protein:null,carbs:null,fat:null,quantity:1,unit:'serving'} as Entry);
const day=(date:string,status:Day['status']):Day=>({id:date,revision:1,deleted:false,date,status});

describe('recent intake before a weigh-in',()=>{
  it('averages the most recent logged days and counts fasting as zero',()=>{
    const intake=recentIntake(
      [entry('2026-09-10',1600),entry('2026-09-10',200),entry('2026-09-08',1500)],
      [day('2026-09-09','fasting')],
      '2026-09-11',
    );
    expect(intake).toEqual({averageKcal:(1800+0+1500)/3,days:3});
  });

  it('skips not-logging decisions and empty days instead of reading them as zero',()=>{
    const intake=recentIntake(
      [entry('2026-09-10',2000),entry('2026-09-07',1800)],
      [day('2026-09-09','not_logged')],
      '2026-09-11',
    );
    expect(intake).toEqual({averageKcal:1900,days:2});
  });

  it('shows nothing with fewer than two logged days',()=>{
    expect(recentIntake([entry('2026-09-10',2000)],[],'2026-09-11')).toBeNull();
  });
});

describe('check-in context summary',()=>{
  it('describes each adjustment in plain language',()=>{
    expect(contextAdjustmentSummary({contextExcluded:1,contextSettling:2,contextReinstated:1}))
      .toBe('1 weigh-in you marked as temporary was left out; 2 later weigh-ins counted less while water settled; 1 marked weigh-in counted again because the weight stayed.');
  });

  it('stays silent when nothing was adjusted or evidence is missing',()=>{
    expect(contextAdjustmentSummary({contextExcluded:0})).toBeNull();
    expect(contextAdjustmentSummary(undefined)).toBeNull();
  });
});
