import {calorieProgress} from './calendarProgress';

export interface DayEnergyPreview {
  /** Calories already on the day; null when the day is not on this device. */
  logged:number|null;
  batch:number;
  after:number|null;
  target:number|null;
  /** Share of the ring the logged food fills, 0–1; null without a known day and usable target. */
  loggedShare:number|null;
  /** Share the batch adds on top, clamped so the two arcs never exceed one full turn. */
  batchShare:number|null;
  /** Target minus the day after logging; negative once the batch passes the target. */
  left:number|null;
}

/** The day as it would stand once the batch is logged. Unknown inputs stay unknown. */
export function dayEnergyPreview(logged:number|null,batch:number,target:number|null):DayEnergyPreview{
  const after=logged==null?null:logged+batch;
  const loggedShare=calorieProgress(logged,target);
  const afterShare=calorieProgress(after,target);
  return {
    logged,
    batch,
    after,
    target,
    loggedShare,
    batchShare:loggedShare==null||afterShare==null?null:afterShare-loggedShare,
    left:after==null||loggedShare==null?null:target!-after,
  };
}
