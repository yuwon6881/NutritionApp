import type {ProfileDraft} from '../types';
import {ageOn} from './age';
import {macroKeys,normalise,splitFromGrams,type MacroSplit} from './macros';
import {allocateWeeklyCalories} from './dailyTargets';

export function calculateResting(p:Pick<ProfileDraft,'age'|'heightCm'|'weightKg'|'sex'>):number{
  if(!p.age||!p.heightCm||!p.weightKg||!p.sex)return 0;
  return 10*p.weightKg+6.25*p.heightCm-5*p.age+(p.sex==='male'?5:-161);
}

/** Mirrors the server: a stored date of birth is authoritative, so age follows the calendar. */
export function profileAge(p:Pick<ProfileDraft,'age'|'dateOfBirth'>,current:string):number{
  return ageOn(p.dateOfBirth,current)??p.age??0;
}

export function estimateExpenditure(p:ProfileDraft,acceptedExpenditure?:number|null):number{
  if(acceptedExpenditure!=null&&acceptedExpenditure>0)return acceptedExpenditure;
  if(p.maintenance!=null&&p.maintenance>0)return p.maintenance;
  const resting=calculateResting(p);
  const activity=p.activity>0?p.activity:1.2;
  return resting>0?resting*activity:0;
}

export const storedSplit=(p:ProfileDraft):MacroSplit|null=>
  p.proteinPercent!=null&&p.carbsPercent!=null&&p.fatPercent!=null
    ?normalise({protein:p.proteinPercent,carbs:p.carbsPercent,fat:p.fatPercent})
    :null;

export interface LivePaceResult{
  resting:number;
  expenditure:number;
  change:number;
  target:number;
  safetyFloor:number;
  protein:number;
  fat:number;
  carbs:number;
  split:MacroSplit|null;
  goalRatePercent:number;
  weeklyCalories:number;
  dailyCalories:number[];
}

export function calculateLivePace(
  p:ProfileDraft,
  percentOverride?:number,
  acceptedExpenditure?:number|null,
  current?:string
):LivePaceResult{
  const age=current?profileAge(p,current):p.age;
  const resting=calculateResting({...p,age});
  const expenditure=estimateExpenditure({...p,age},acceptedExpenditure);
  const goal=p.goal||'maintain';
  const legacyPercent=percentOverride??p.energyAdjustmentPercent;
  const goalRate=p.goalRatePercent??(goal==='lose'?-0.5:goal==='gain'?0.15:0);
  const change=p.goalRatePercent!=null
    ?p.weightKg*goalRate/100*7700/7
    :goal==='lose'
      ?-expenditure*(legacyPercent??15)/100
      :goal==='gain'
        ?expenditure*(legacyPercent??5)/100
        :0;

  let target=expenditure>0?Math.round((expenditure+change)/25)*25:2000;
  const safetyFloor=expenditure>0?Math.ceil(Math.max(1500,expenditure*0.75)/25)*25:1500;
  target=Math.max(target,safetyFloor);

  const chosen=storedSplit(p);
  let protein:number;let fat:number;let carbs:number;
  if(chosen){
    protein=Math.round(target*chosen.protein/100/4);
    fat=Math.round((target*chosen.fat/100/9)*10)/10;
    carbs=Math.round((target*chosen.carbs/100/4)*10)/10;
  }else{
    protein=p.proteinGrams??(p.weightKg>0?Math.round(p.weightKg*(p.resistanceTraining&&goal==='lose'?2:1.6)):120);
    fat=Math.round((target*0.3/9)*10)/10;
    carbs=Math.max(0,Math.round(((target-protein*4-fat*9)/4)*10)/10);
  }

  return {
    resting:Math.round(resting),
    expenditure:Math.round(expenditure),
    change:Math.round(change),
    target,
    safetyFloor,
    protein,
    fat,
    carbs,
    split:chosen??splitFromGrams(target,{protein,carbs,fat}),
    goalRatePercent:goalRate,
    weeklyCalories:target*7,
    dailyCalories:allocateWeeklyCalories(target*7,p.distributionShares),
  };
}

/** The split shown when nothing is stored: the coach default expressed as shares. */
export function effectiveSplit(p:ProfileDraft,acceptedExpenditure?:number|null,current?:string):MacroSplit{
  const live=calculateLivePace(p,undefined,acceptedExpenditure,current);
  return live.split??normalise({protein:30,carbs:40,fat:30});
}

export const splitsEqual=(left:MacroSplit|null,right:MacroSplit|null)=>
  left!=null&&right!=null&&macroKeys.every(key=>left[key]===right[key]);
