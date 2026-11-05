import {describe,expect,it} from 'vitest';
import type {TrajectoryPoint} from '../types';
import {holdKind,holdRuns,lineRuns,maintenanceDays} from './maintenanceTrend';

const point=(date:string,expenditure:number|null,holdReason:string|null=null,revision=1):TrajectoryPoint=>
  ({date,revision,expenditure,suggestedCalories:null,confidence:0,holdReason,algorithmVersion:'v9-unlogged-days',trendWeightKg:null});

const weighIns='14 of 28 days logged. Holding: need eight retained weigh-ins spanning 21 days, with three in each half and one within four days. Current evidence: 9 weigh-ins spanning 13 days.';
const logging='9 of 28 days logged. Holding: need at least 14 logged days, 60% coverage, and four logged days in the most recent seven.';

describe('holdKind',()=>{
  it('reads the server hold sentences',()=>{
    expect(holdKind(null)).toBeNull();
    expect(holdKind(logging)).toBe('logging');
    expect(holdKind(weighIns)).toBe('weighIns');
    expect(holdKind(' Holding: your intake changed by about 400 kcal/day around Oct 2. Water and glycogen shift for about a week after that.')).toBe('intakeChange');
    expect(holdKind(' Holding: the trend and endpoint slopes disagree by more than 0.5 kg per week.')).toBe('weightShift');
    expect(holdKind(' Holding: your weight trend rose about 120 kcal/day more across unlogged days than logged days.')).toBe('unlogged');
    expect(holdKind(' Holding: the observed estimate is outside the supported range.')).toBe('review');
    expect(holdKind('Something new')).toBe('other');
  });
});

describe('maintenanceDays',()=>{
  it('starts at the first estimate in range, keeps the newest revision, and leaves missing days empty',()=>{
    const days=maintenanceDays([
      point('2026-10-30',2400),
      point('2026-11-02',2500,logging),
      point('2026-11-02',2510,null,2),
      point('2026-11-04',2520),
      point('2026-11-06',2600)
    ],'2026-11-01','2026-11-05');
    expect(days).toEqual([
      {date:'2026-11-02',kcal:2510,hold:null},
      {date:'2026-11-03',kcal:null,hold:null},
      {date:'2026-11-04',kcal:2520,hold:null},
      {date:'2026-11-05',kcal:null,hold:null}
    ]);
  });

  it('is empty when no estimate falls in range',()=>{
    expect(maintenanceDays([point('2026-10-01',2400)],'2026-11-01','2026-11-05')).toEqual([]);
  });
});

describe('runs',()=>{
  const days=maintenanceDays([
    point('2026-11-01',2400,logging),
    point('2026-11-02',2400,logging),
    point('2026-11-03',2400,weighIns),
    point('2026-11-04',2420),
    point('2026-11-05',2440),
    point('2026-11-07',2440,weighIns)
  ],'2026-11-01','2026-11-07');

  it('shades held days and splits where the cause changes',()=>{
    expect(holdRuns(days)).toEqual([
      {from:0,to:1,kind:'logging'},
      {from:2,to:2,kind:'weighIns'},
      {from:6,to:6,kind:'weighIns'}
    ]);
  });

  it('joins adapting and holding pieces without a gap and breaks at a missing day',()=>{
    expect(lineRuns(days)).toEqual([
      {from:0,to:2,held:true},
      {from:2,to:4,held:false},
      {from:6,to:6,held:true}
    ]);
  });
});
