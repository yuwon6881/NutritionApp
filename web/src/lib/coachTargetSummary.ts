import type {GoalProgress,UnitPreferences,WeightUnit} from '../types';
import {readableDate} from './format';
import {goalLabel} from './goalHistory';
import {displayWeight,weightLabel} from './units';
import {weeklyPaceMass} from './coachPlanHelpers';

export type EnergyGap={kcal:number;direction:'below'|'above'|'at'};

/**
 * How far the daily target sits from maintenance. Null when either figure is unknown,
 * so a missing expenditure never reads as a zero gap.
 */
export function energyGap(calories:number|null|undefined,expenditure:number|null|undefined):EnergyGap|null{
  if(calories==null||expenditure==null||!Number.isFinite(calories)||!Number.isFinite(expenditure))return null;
  const kcal=Math.round(Math.abs(expenditure-calories));
  if(kcal===0)return {kcal:0,direction:'at'};
  return {kcal,direction:calories<expenditure?'below':'above'};
}

/** Protein per kilogram of body weight to one decimal; null when either figure is unusable. */
export function proteinPerKg(proteinGrams:number|null|undefined,weightKg:number|null|undefined):number|null{
  if(proteinGrams==null||weightKg==null||!Number.isFinite(proteinGrams)||!Number.isFinite(weightKg)||weightKg<=0)return null;
  return Math.round(proteinGrams/weightKg*10)/10;
}

/** The weekly rate in plain words, e.g. "0.5% of body weight per week (about 0.3 kg)". */
export function paceSentence(percent:number,weightKg:number|null|undefined,unit:WeightUnit):string{
  const rate=`${Number(Math.abs(percent).toFixed(2))}% of body weight per week`;
  const massKg=weeklyPaceMass(percent,weightKg);
  if(massKg==null||massKg<=0)return rate;
  return `${rate} (about ${displayWeight(massKg,unit,1)} ${weightLabel(unit)})`;
}

/** One sentence naming what the plan is working toward, from the merged goal progress. */
export function planHeadline(progress:GoalProgress|null,goal:string,units:UnitPreferences):string{
  const name=goalLabel(goal||'maintain');
  if(!progress)return name;
  if(progress.complete||progress.scaleReached||progress.trendReached)return 'Goal reached';
  if(progress.mode==='weight'&&progress.remaining!=null&&progress.remaining>0){
    const verb=(progress.goal??goal)==='gain'?'Gain':'Lose';
    const finish=progress.optimisticFinish??progress.estimatedFinish;
    const left=`${verb} ${displayWeight(progress.remaining,units.weight,1)} ${weightLabel(units.weight)}`;
    return finish?`${left} by ${readableDate(finish)}`:left;
  }
  if(progress.mode==='duration'&&progress.phaseEnd)return `${name} until ${readableDate(progress.phaseEnd)}`;
  return name;
}
