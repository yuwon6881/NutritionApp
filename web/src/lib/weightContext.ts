import type {Weight,WeightContextCode,WeightUnit} from '../types';
import {parseWeight} from './units';

export const weightContextOptions:{value:WeightContextCode;label:string}[]=[
  {value:'stress',label:'Stress'},
  {value:'bloating',label:'Bloating or water retention'},
  {value:'menstrual_cycle',label:'Menstrual cycle'},
  {value:'illness',label:'Illness'},
  {value:'travel',label:'Travel'},
  {value:'other_temporary',label:'Another temporary factor'},
  {value:'genuine_change',label:'A genuine change'},
  {value:'unsure',label:'Unsure'},
];

export interface UnusualWeightDifference {
  medianKg:number;
  differenceKg:number;
  thresholdKg:number;
}

/** Compare a valid display-unit input with at least three earlier entries in the prior 14 days. */
export function unusualWeightDifference(
  enteredValue:string,
  unit:WeightUnit,
  date:string,
  weights:readonly Weight[],
  excludeId?:string,
):UnusualWeightDifference|null{
  const enteredKg=parseWeight(enteredValue,unit);
  if(!Number.isFinite(enteredKg)||enteredKg<20||enteredKg>400)return null;
  const target=Date.parse(`${date}T00:00:00Z`);
  if(!Number.isFinite(target))return null;
  const earlier=weights.filter(weight=>{
    if(weight.deleted||weight.id===excludeId||!Number.isFinite(weight.kg))return false;
    const day=Date.parse(`${weight.date}T00:00:00Z`);
    return day<target&&day>=target-14*24*60*60*1000;
  }).map(weight=>weight.kg).sort((a,b)=>a-b);
  if(earlier.length<3)return null;
  const middle=Math.floor(earlier.length/2);
  const medianKg=earlier.length%2?earlier[middle]:(earlier[middle-1]+earlier[middle])/2;
  const differenceKg=Math.abs(enteredKg-medianKg);
  const thresholdKg=Math.max(1,medianKg*.015);
  return differenceKg>thresholdKg?{medianKg,differenceKg,thresholdKg}:null;
}

export function weightContextLabel(context:WeightContextCode|undefined|null){
  return weightContextOptions.find(option=>option.value===context)?.label??'';
}
