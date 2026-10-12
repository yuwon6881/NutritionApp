import {describe,expect,it} from 'vitest';
import type {ProfileDraft} from '../types';
import {carryExpenditure,equationProfile} from './profileExpenditure';
import {estimateExpenditure} from './coachCalc';

const profile:ProfileDraft={
  age:25,dateOfBirth:null,heightCm:173,weightKg:66,sex:'male',activity:1.375,
  goal:'maintain',maintenance:null,proteinGrams:null,resistanceTraining:true,
  pregnancyOrBreastfeeding:false,medicalNutrition:false,timeZone:'UTC'
};

describe('profile expenditure',()=>{
  it('uses diary trend weight without altering the corrected profile',()=>{
    const draft={...profile,weightKg:75};
    const inputs=equationProfile(draft,[{date:'2026-10-12',kg:66}], '2026-10-12');
    expect(estimateExpenditure(inputs)).toBe(2229.21875);
    expect(draft.weightKg).toBe(75);
    expect(equationProfile(draft,[], '2026-10-12').weightKg).toBe(75);
  });
  it('resets body corrections and uses the corrected equation inputs',()=>{
    const before={...profile,heightCm:180,weightKg:80};
    const seed=carryExpenditure(before,profile,2700);
    expect(seed).toBeNull();
    expect(estimateExpenditure(profile,seed)).toBe(2229.21875);
    for(const patch of [{sex:'female' as const},{age:28},{dateOfBirth:'2001-01-01'},{maintenance:2400}])
      expect(carryExpenditure(profile,{...profile,...patch},2700)).toBeNull();
  });

  it('retains goal edits and scales activity edits',()=>{
    expect(carryExpenditure(profile,{...profile,goal:'gain'},2500)).toBe(2500);
    expect(carryExpenditure(profile,{...profile,activity:1.65},2500)).toBe(3000);
    const dated={...profile,dateOfBirth:'2001-01-01'};
    expect(carryExpenditure(dated,{...dated,age:26},2500)).toBe(2500);
  });

  it('uses a changed manual maintenance and handles absent history',()=>{
    const after={...profile,maintenance:2400};
    expect(estimateExpenditure(after,carryExpenditure(profile,after,2700))).toBe(2400);
    expect(carryExpenditure(null,profile,2700)).toBeNull();
    expect(carryExpenditure(profile,profile,Number.NaN)).toBeNull();
  });

  it('retains learned maintenance when the default changes for the same activity choice',()=>{
    const before:ProfileDraft={...profile,activityLevel:'lifting',activity:1.5};
    const after:ProfileDraft={...before,activity:1.375,goal:'gain'};
    expect(carryExpenditure(before,after,2700)).toBe(2700);
    expect(carryExpenditure(before,{...after,activityLevel:'cardio',activity:1.5},2700)).toBe(2700*1.5/1.375);
  });
});
