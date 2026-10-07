import type {Weight,WeightContextCode,WeightUnit} from '../types';
import {trend} from './format';
import {median,unusualWeightDifference,weightContextRule} from './weightContext';

/** Mirrors the policy block of tests/fixtures/weight-context.json and the server's WeightSignal. */
export const weightSignalPolicy={
  confirmationDays:7,
  confirmingWeighIns:3,
  confirmationToleranceKg:.5,
  maxAdjustedShare:.3,
  outlierHalfWindowDays:3,
  outlierWideHalfWindowDays:7,
  outlierMinNeighbours:3,
  outlierThresholdSigma:3,
  outlierNoiseFloorKg:.3,
  madScale:1.4826,
} as const;

export type SignalPoint={date:string;kg:number;context?:WeightContextCode|null};

const dayNumber=(date:string)=>Date.parse(`${date}T00:00:00Z`)/86400000;
const temporary=(point:SignalPoint)=>!!weightContextRule(point.context)?.temporary;
const shift=(date:string,days:number)=>new Date(Date.parse(`${date}T00:00:00Z`)+days*86400000).toISOString().slice(0,10);

/**
 * Weigh-ins that count toward the trend. A temporary context excludes its day until at least three later unmarked
 * weigh-ins within a week show the weight stayed there; then the day counts again, so a label cannot hide a change.
 */
export function countedWeighIns<T extends SignalPoint>(points:readonly T[]){
  const {confirmationDays,confirmingWeighIns,confirmationToleranceKg}=weightSignalPolicy;
  const ordered=[...points].sort((a,b)=>a.date.localeCompare(b.date));
  return ordered.filter(point=>{
    if(!temporary(point))return true;
    const start=dayNumber(point.date);
    const later=ordered.filter(other=>{
      const elapsed=dayNumber(other.date)-start;
      return elapsed>0&&elapsed<=confirmationDays&&!temporary(other);
    }).map(other=>other.kg);
    return later.length>=confirmingWeighIns&&Math.abs(median(later)-point.kg)<=confirmationToleranceKg;
  });
}

function neighbours(points:readonly SignalPoint[],index:number,halfWindow:number){
  const day=dayNumber(points[index].date);
  const values:number[]=[];
  for(let j=index-1;j>=0&&day-dayNumber(points[j].date)<=halfWindow;j--)values.push(points[j].kg);
  for(let j=index+1;j<points.length&&dayNumber(points[j].date)-day<=halfWindow;j++)values.push(points[j].kg);
  return values;
}

/** Hampel filter against each weigh-in's neighbours; noise comes from the recent window. */
export function outlierDates(points:readonly SignalPoint[],today:string,windowDays=28){
  const {outlierHalfWindowDays,outlierWideHalfWindowDays,outlierMinNeighbours,outlierThresholdSigma,outlierNoiseFloorKg,madScale}=weightSignalPolicy;
  const residuals=new Map<string,number>();
  points.forEach((point,index)=>{
    let nearby=neighbours(points,index,outlierHalfWindowDays);
    if(nearby.length<outlierMinNeighbours)nearby=neighbours(points,index,outlierWideHalfWindowDays);
    if(nearby.length>=outlierMinNeighbours)residuals.set(point.date,point.kg-median(nearby));
  });
  const start=shift(today,-windowDays);
  const recent=[...residuals].filter(([date])=>date>=start&&date<today).map(([,value])=>value);
  const center=median(recent);
  const noise=recent.length?madScale*median(recent.map(value=>Math.abs(value-center))):0;
  const threshold=outlierThresholdSigma*Math.max(noise,outlierNoiseFloorKg);
  return new Set([...residuals].filter(([,value])=>Math.abs(value)>threshold).map(([date])=>date));
}

/** The trend without marked days or statistical outliers; matches the server's WeightSignal.CleanTrend. */
export function cleanTrend(points:readonly SignalPoint[],today:string,windowDays=28){
  const counted=countedWeighIns(points).filter(point=>point.date<=today);
  const flags=outlierDates(counted,today,windowDays);
  return trend(counted.filter(point=>!flags.has(point.date)));
}

/**
 * The unusual weigh-in check against the weigh-ins that count toward the trend. An unconfirmed marked
 * day (bloating, a salty meal) is not the level to expect next, or a normal return would read as a drop.
 */
export function unusualWeighIn(enteredValue:string,unit:WeightUnit,date:string,weights:readonly Weight[],excludeId?:string){
  const baseline=countedWeighIns(weights.filter(weight=>!weight.deleted&&weight.id!==excludeId));
  return unusualWeightDifference(enteredValue,unit,date,baseline);
}
