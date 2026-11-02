import {describe,expect,it} from 'vitest';
import {checkInFacts,checkInHeadline} from './checkInSummary';

const evidence={windowDays:28,loggedDays:17,coverage:.6,weighIns:20,weighInSpanDays:27,meanIntake:1900,slopeKgPerDay:0,noiseKg:.3,waterFlaggedDays:0,confidence:.6,unloggedDays:11,unloggedMeanIntake:2468,contextExcluded:2};

describe('check-in summary',()=>{
  it('prefers a hold reason, then states whether the target moved',()=>{
    expect(checkInHeadline({holdReason:' Holding: more logs needed. ',changed:true})).toBe('Holding: more logs needed.');
    expect(checkInHeadline({changed:false})).toMatch(/stays the same/);
    expect(checkInHeadline({changed:true})).toMatch(/Updated/);
  });
  it('lists evidence rows and omits unknown ones',()=>{
    const facts=checkInFacts(evidence,'kcal');
    expect(facts[0]).toEqual({label:'Days logged',value:'17 of 28'});
    expect(facts.find(f=>f.label==='Unlogged days')?.value).toBe('11, counted at about 2470 kcal/day');
    expect(facts.find(f=>f.label==='Marked weigh-ins')).toBeTruthy();
    expect(checkInFacts({...evidence,unloggedDays:0,contextExcluded:0},'kcal').map(f=>f.label)).toEqual(['Days logged','Weigh-ins used']);
    expect(checkInFacts(null,'kcal')).toEqual([]);
  });
});
