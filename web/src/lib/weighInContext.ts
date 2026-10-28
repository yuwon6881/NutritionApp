import type {WeightUnit} from '../types';
import {displayWeight,weightLabel,weightValue} from './units';
import {shortDate} from './format';

export interface WeighInRecord {
  date:string;
  kg:number;
}

/**
 * Builds the single-line context string for the weight entry dialog:
 * "Last weigh-in 82.9 kg · 3 days ago" (with optional " · Trend 82.7 kg").
 * If there is no weigh-in recorded, returns an empty string.
 */
export function weighInContext(
  lastWeighIn:WeighInRecord|null|undefined,
  current:string,
  unit:WeightUnit,
  trendKg?:number|null,
):string{
  if(!lastWeighIn||lastWeighIn.kg==null||!Number.isFinite(lastWeighIn.kg))return '';
  const weightStr=`${displayWeight(lastWeighIn.kg,unit,1)} ${weightLabel(unit)}`;
  const msPerDay=86400000;
  const diffDays=Math.round((Date.parse(`${current}T00:00:00Z`)-Date.parse(`${lastWeighIn.date}T00:00:00Z`))/msPerDay);
  const dateStr=diffDays<=0?'today'
    :diffDays===1?'yesterday'
    :diffDays<=14?`${diffDays} days ago`
    :shortDate(lastWeighIn.date);
  const trendStr=trendKg!=null&&Number.isFinite(trendKg)
    ?` · Trend ${displayWeight(trendKg,unit,1)} ${weightLabel(unit)}`
    : '';
  return `Last weigh-in ${weightStr} · ${dateStr}${trendStr}`;
}

/** Min and max values matching the weight field's bounds for kg and lb. */
export function weightBounds(unit:WeightUnit):{min:number;max:number}{
  return unit==='lb'?{min:44.1,max:881.8}:{min:20,max:400};
}

/**
 * Steps the display weight string up or down by 0.1 in the given unit.
 * Clamps to min/max bounds and avoids floating-point noise with Math.round(v * 10) / 10.
 * If the current value is empty, starts from the last weigh-in value if available; otherwise returns ''.
 */
export function stepWeight(
  value:string,
  direction:'up'|'down',
  unit:WeightUnit,
  lastWeightKg?:number|null,
):string{
  const {min,max}=weightBounds(unit);
  let base:number;
  const trimmed=value.trim();
  if(trimmed===''){
    if(lastWeightKg==null||!Number.isFinite(lastWeightKg))return '';
    const inDisplay=weightValue(lastWeightKg,unit);
    if(inDisplay==null||!Number.isFinite(inDisplay))return '';
    base=Math.round(inDisplay*10)/10;
  }else{
    const parsed=Number(trimmed);
    if(!Number.isFinite(parsed)){
      if(lastWeightKg==null||!Number.isFinite(lastWeightKg))return value;
      const inDisplay=weightValue(lastWeightKg,unit);
      if(inDisplay==null||!Number.isFinite(inDisplay))return value;
      base=Math.round(inDisplay*10)/10;
    }else{
      base=parsed;
    }
  }

  const delta=direction==='up'?0.1:-0.1;
  const stepped=Math.round((base+delta)*10)/10;
  const clamped=Math.min(max,Math.max(min,stepped));
  return (Math.round(clamped*10)/10).toFixed(1);
}
