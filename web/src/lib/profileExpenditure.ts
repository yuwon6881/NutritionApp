import type {ProfileDraft} from '../types';
import {cleanTrend,type SignalPoint} from './weightSignal';
import {activityFields} from './activityLevels';
import {normalizeProfileSex} from './profile';

/** Keep the editor draft identical to the request that starts a new coaching proposal. */
export function prepareCoachingProfile(profile:ProfileDraft,current:string,startWeightKg:number):ProfileDraft{
  return normalizeProfileSex({
    ...profile,
    ...(profile.activityLevel?activityFields(profile.activityLevel):{}),
    phaseStart:current,
    phaseStartWeightKg:startWeightKg,
    targetWeightKg:profile.goal==='maintain'?null:profile.targetWeightKg
  });
}

/** Diary weight is authoritative for the equation and pace, without editing the stored profile. */
export function equationProfile(profile:ProfileDraft,weights:readonly SignalPoint[],current:string):ProfileDraft{
  return {...profile,weightKg:cleanTrend(weights,current).at(-1)?.kg??profile.weightKg};
}

/** Mirrors GoalPolicy.CarryExpenditure: body corrections reset; goal edits retain the seed. */
export function carryExpenditure(before:ProfileDraft|null|undefined,after:ProfileDraft,expenditure?:number|null):number|null{
  if(!before||expenditure==null||!Number.isFinite(expenditure)||expenditure<=0)return null;
  if(before.maintenance!==after.maintenance||before.heightCm!==after.heightCm||
    before.weightKg!==after.weightKg||before.sex!==after.sex||
    before.dateOfBirth!==after.dateOfBirth||(!after.dateOfBirth&&before.age!==after.age))return null;
  const beforeActivity=before.activityLevel?activityFields(before.activityLevel).activity:before.activity;
  const afterActivity=after.activityLevel?activityFields(after.activityLevel).activity:after.activity;
  if(beforeActivity<=0||afterActivity<=0)return null;
  return Math.min(7000,Math.max(1000,expenditure*afterActivity/beforeActivity));
}
