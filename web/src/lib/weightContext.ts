import type {Weight,WeightContextCode,WeightUnit} from '../types';
import {parseWeight} from './units';

export type WeightContextDirection='up'|'down'|'either';
export interface WeightContextRule {code:WeightContextCode;label:string;direction:WeightContextDirection;temporary:boolean;settleDays:number}

/** Mirrors tests/fixtures/weight-context.json, which the server's WeightContextPolicy also matches. */
export const weightContextRules:readonly WeightContextRule[]=[
  {code:'high_sodium',label:'Salty food',direction:'up',temporary:true,settleDays:2},
  {code:'high_carb',label:'High-carb day or refeed',direction:'up',temporary:true,settleDays:3},
  {code:'alcohol',label:'Alcohol',direction:'up',temporary:true,settleDays:2},
  {code:'poor_sleep',label:'Poor sleep',direction:'up',temporary:true,settleDays:1},
  {code:'stress',label:'Stress',direction:'up',temporary:true,settleDays:1},
  {code:'hard_training',label:'Hard training or soreness',direction:'up',temporary:true,settleDays:2},
  {code:'bloating',label:'Bloating or water retention',direction:'up',temporary:true,settleDays:1},
  {code:'menstrual_cycle',label:'Menstrual cycle',direction:'up',temporary:true,settleDays:5},
  {code:'digestion',label:'Digestion or a late large meal',direction:'either',temporary:true,settleDays:1},
  {code:'dehydration',label:'Heavy sweating or dehydration',direction:'down',temporary:true,settleDays:1},
  {code:'low_carb',label:'Low-carb day or glycogen drop',direction:'down',temporary:true,settleDays:3},
  {code:'illness',label:'Illness',direction:'either',temporary:true,settleDays:3},
  {code:'travel',label:'Travel',direction:'either',temporary:true,settleDays:2},
  {code:'other_temporary',label:'Another temporary factor',direction:'either',temporary:true,settleDays:1},
  {code:'genuine_change',label:'A genuine change',direction:'either',temporary:false,settleDays:0},
  {code:'unsure',label:'Unsure',direction:'either',temporary:false,settleDays:0},
];

export const weightContextOptions:{value:WeightContextCode;label:string}[]=weightContextRules.map(rule=>({value:rule.code,label:rule.label}));

/** A spike offers retention causes and a drop offers depletion causes; neutral answers are always available. */
export function weightContextOptionsFor(direction:'up'|'down'){
  return weightContextRules.filter(rule=>rule.direction==='either'||rule.direction===direction).map(rule=>({value:rule.code,label:rule.label}));
}

export function weightContextRule(context:WeightContextCode|undefined|null){
  return weightContextRules.find(rule=>rule.code===context);
}

export interface UnusualWeightDifference {
  medianKg:number;
  /** Where recent weigh-ins put today: the median, carried forward along a clear recent trend. */
  expectedKg:number;
  differenceKg:number;
  thresholdKg:number;
  direction:'up'|'down';
}

const dayNumber=(date:string)=>Date.parse(`${date}T00:00:00Z`)/86400000;

export function median(values:readonly number[]){
  const sorted=[...values].sort((a,b)=>a-b);
  if(!sorted.length)return 0;
  const middle=Math.floor(sorted.length/2);
  return sorted.length%2?sorted[middle]:(sorted[middle-1]+sorted[middle])/2;
}

/** Robust slope: the median of all pairwise slopes. */
export function theilSen(points:readonly {day:number;kg:number}[]){
  const slopes:number[]=[];
  for(let i=0;i<points.length;i++)for(let j=i+1;j<points.length;j++){
    const days=points[j].day-points[i].day;
    if(days)slopes.push((points[j].kg-points[i].kg)/days);
  }
  return median(slopes);
}

/**
 * Compare a valid display-unit input with at least three earlier entries in the prior 14 days. With four or more
 * spanning a week, the expected value follows the recent trend, so a steady cut or bulk is not mistaken for an
 * unusual reading and a real spike is not hidden by a lagging median.
 */
export function unusualWeightDifference(
  enteredValue:string,
  unit:WeightUnit,
  date:string,
  weights:readonly Weight[],
  excludeId?:string,
):UnusualWeightDifference|null{
  const enteredKg=parseWeight(enteredValue,unit);
  if(!Number.isFinite(enteredKg)||enteredKg<20||enteredKg>400)return null;
  const target=dayNumber(date);
  if(!Number.isFinite(target))return null;
  const earlier=weights.filter(weight=>{
    if(weight.deleted||weight.id===excludeId||!Number.isFinite(weight.kg))return false;
    const day=dayNumber(weight.date);
    return day<target&&day>=target-14;
  }).map(weight=>({day:dayNumber(weight.date),kg:weight.kg}));
  if(earlier.length<3)return null;
  const medianKg=median(earlier.map(point=>point.kg));
  const days=earlier.map(point=>point.day);
  const spansWeek=Math.max(...days)-Math.min(...days)>=7;
  const expectedKg=earlier.length>=4&&spansWeek?medianKg+theilSen(earlier)*(target-median(days)):medianKg;
  const signed=enteredKg-expectedKg;
  const differenceKg=Math.abs(signed);
  const thresholdKg=Math.max(1,expectedKg*.015);
  return differenceKg>thresholdKg?{medianKg,expectedKg,differenceKg,thresholdKg,direction:signed>0?'up':'down'}:null;
}

export function weightContextLabel(context:WeightContextCode|undefined|null){
  return weightContextRule(context)?.label??'';
}
