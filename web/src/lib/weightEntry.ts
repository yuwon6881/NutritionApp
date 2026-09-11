import type {Weight,WeightUnit} from '../types';
import {inputWeight} from './units';

export interface WeightEntryValues {date:string;kg:string}

/**
 * The values a freshly opened weigh-in dialog holds. The dialog's fields and its dirty baseline
 * must come from this one function: deriving the baseline separately left an untouched form
 * comparing itself against an empty baseline and asking to discard changes on its first close.
 */
export function weightEntryValues(
  date:string|undefined,
  current:string,
  weights:readonly Weight[],
  initial:Weight|undefined,
  unit:WeightUnit,
):WeightEntryValues{
  const target=date??current;
  const existing=initial??weights.find(weight=>!weight.deleted&&weight.date===target);
  return {date:existing?.date??target,kg:existing?inputWeight(existing.kg,unit,2):''};
}

export function weightEntryDirty(values:WeightEntryValues,baseline:WeightEntryValues){
  return values.date!==baseline.date||values.kg!==baseline.kg;
}
