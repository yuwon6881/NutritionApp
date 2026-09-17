import {describe,expect,it} from 'vitest';
import {goalWeightBounds,phaseEndDate,resolveGoalStartWeight} from './goalPhase';

const weights=[
  {date:'2026-09-10',kg:80,deleted:false},
  {date:'2026-09-12',kg:79,deleted:false},
  {date:'2026-09-15',kg:78,deleted:false}
];

describe('goal phase helpers',()=>{
  it('uses the profile weight when no weigh-ins are available',()=>{
    expect(resolveGoalStartWeight({fallbackKg:81,weights:[],trendSeed:[],metric:'scale',current:'2026-09-16'})).toBe(81);
  });

  it('uses the latest scale weight or trend weight according to the setting',()=>{
    const scale=resolveGoalStartWeight({fallbackKg:81,weights,trendSeed:[],metric:'scale',current:'2026-09-16'});
    const trend=resolveGoalStartWeight({fallbackKg:81,weights,trendSeed:[],metric:'trend',current:'2026-09-16'});
    expect(scale).toBe(78);
    expect(trend).toBeLessThan(80);
    expect(trend).toBeGreaterThan(79);
  });

  it('uses a realistic one-decimal phase range and respects the underweight floor',()=>{
    expect(goalWeightBounds('lose',80)).toEqual({min:64,max:80});
    expect(goalWeightBounds('gain',80)).toEqual({min:80,max:96});
    expect(goalWeightBounds('lose',65,170)).toEqual({min:53.5,max:65});
  });

  it('calculates the phase end from today and duration weeks',()=>{
    expect(phaseEndDate('2026-09-16',8)).toBe('2026-11-11');
  });
});
