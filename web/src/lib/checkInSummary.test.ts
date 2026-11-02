import {describe,expect,it} from 'vitest';
import {checkInAdjustments,checkInFigures,checkInHeadline} from './checkInSummary';

const evidence={windowDays:28,loggedDays:17,coverage:.6,weighIns:19,weighInSpanDays:26,meanIntake:1900,slopeKgPerDay:0,noiseKg:.3,waterFlaggedDays:0,confidence:.6,unloggedDays:11,unloggedMeanIntake:2468,contextExcluded:2,contextSettling:2,contextReinstated:1};

describe('check-in summary',()=>{
  it('prefers a hold reason, then states whether the target moved',()=>{
    expect(checkInHeadline({holdReason:' Holding: more logs needed. ',changed:true})).toBe('Holding: more logs needed.');
    expect(checkInHeadline({changed:false})).toMatch(/stays the same/);
    expect(checkInHeadline({changed:true})).toMatch(/Updated/);
  });
  it('shows evidence as short figures and omits unknown ones',()=>{
    expect(checkInFigures(evidence,'kcal')).toEqual([
      {label:'Days logged',value:'17/28'},
      {label:'Unlogged',value:'11',note:'≈ 2470 kcal/day'},
      {label:'Weigh-ins',value:'19',note:'over 26 days'},
    ]);
    expect(checkInFigures({...evidence,unloggedDays:0},'kcal').map(f=>f.label)).toEqual(['Days logged','Weigh-ins']);
    expect(checkInFigures(null,'kcal')).toEqual([]);
  });
  it('describes ignored and restored weigh-ins in plain sentences and omits settling',()=>{
    expect(checkInAdjustments(evidence)).toEqual([
      {kind:'ignored',lead:'2 weigh-ins ignored.',detail:"You marked them as temporary, so they didn't affect your calories."},
      {kind:'counted',lead:'1 weigh-in counted after all.',detail:'Your weight stayed at that level, so it was real.'},
    ]);
    expect(checkInAdjustments({...evidence,contextExcluded:1,contextReinstated:3})[0].detail).toMatch(/marked it as temporary, so it didn't/);
    expect(checkInAdjustments({...evidence,contextExcluded:0,contextSettling:4,contextReinstated:0})).toEqual([]);
    expect(checkInAdjustments(null)).toEqual([]);
  });
});
