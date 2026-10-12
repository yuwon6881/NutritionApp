import {describe,it,expect} from 'vitest';
import {normalizeProfileSex,profilesEqual} from './profile';
import {prepareCoachingProfile} from './profileExpenditure';
import type {Profile} from '../types';
describe('profile sync comparison',()=>{it('ignores JSON property order while detecting changed phase choices',()=>{
  const profile={age:30,dateOfBirth:null,heightCm:175,weightKg:80,sex:'male',activity:1.4,goal:'lose',maintenance:null,proteinGrams:null,resistanceTraining:true,pregnancyOrBreastfeeding:false,medicalNutrition:false,timeZone:'Asia/Kuala_Lumpur',phaseMode:'weight',targetWeightKg:75,energyAdjustmentPercent:15} satisfies Profile;
  expect(profilesEqual(profile,Object.fromEntries(Object.entries(profile).reverse()) as Profile)).toBe(true);
  expect(profilesEqual(profile,{...profile,energyAdjustmentPercent:20})).toBe(false);
});});
it('clears stale pregnancy on male selection and retains non-male selections',()=>{
  const female={sex:'female',pregnancyOrBreastfeeding:true} as Profile;
  expect(normalizeProfileSex(female)).toEqual(female);
  const male=normalizeProfileSex({...female,sex:'male'});
  expect(male.pregnancyOrBreastfeeding).toBe(false);
  expect(normalizeProfileSex({...male,sex:'female'}).pregnancyOrBreastfeeding).toBe(false);
  expect(normalizeProfileSex({...female,sex:''}).pregnancyOrBreastfeeding).toBe(true);
});

it('prepares matching proposal fields without changing the original draft',()=>{
  const draft:Profile={age:25,dateOfBirth:null,heightCm:173,weightKg:66,sex:'male',activity:1.5,
    activityLevel:'lifting',goal:'lose',maintenance:null,proteinGrams:null,resistanceTraining:false,
    pregnancyOrBreastfeeding:true,medicalNutrition:false,timeZone:'UTC',phaseStartWeightKg:80,targetWeightKg:60};
  const submitted=prepareCoachingProfile(draft,'2026-10-12',66);
  expect(submitted).toMatchObject({phaseStart:'2026-10-12',phaseStartWeightKg:66,targetWeightKg:60,
    activity:1.375,resistanceTraining:true,pregnancyOrBreastfeeding:false});
  expect(draft.phaseStartWeightKg).toBe(80);
  expect(prepareCoachingProfile({...draft,goal:'maintain',activityLevel:undefined},'2026-10-12',66))
    .toMatchObject({activity:1.5,targetWeightKg:null});
});
