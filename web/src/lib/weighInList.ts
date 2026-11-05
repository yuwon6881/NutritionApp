import type {ProgressWeightPoint,Weight} from '../types';

/**
 * Scale change from the closest earlier weigh-in in the chart series, or null
 * when this is the first weigh-in shown. The series spans the whole period,
 * so a row still finds its predecessor when that one is no longer editable.
 *
 * Uses binary search over the date-ordered series to guarantee O(log N) lookup
 * even across multi-year histories with thousands of weigh-in records.
 */
export function changeSincePrevious(series:readonly ProgressWeightPoint[],date:string,kg:number):number|null{
  const len=series.length;
  if(!len)return null;
  let low=0;
  let high=len-1;
  let prevIndex=-1;
  while(low<=high){
    const mid=(low+high)>>1;
    if(series[mid].date<date){
      prevIndex=mid;
      low=mid+1;
    }else{
      high=mid-1;
    }
  }
  return prevIndex>=0?kg-series[prevIndex].scaleKg:null;
}

/**
 * The most recent scale weigh-ins up to `current`, newest first, for the Dashboard
 * preview of the weigh-in history. Deleted records and planned future dates are left out.
 */
export function latestWeighIns(weights:readonly Weight[],current:string,count:number):Weight[]{
  return weights
    .filter(weight=>!weight.deleted&&weight.date<=current)
    .sort((a,b)=>b.date.localeCompare(a.date))
    .slice(0,count);
}

/**
 * The Progress weigh-in list: the summary's projected rows (which already carry queued edits)
 * win over older rows paged in from the server, queued deletions disappear at once, and the
 * result reads newest first.
 */
export function mergeWeighInRows(projected:readonly Weight[],paged:readonly Weight[],pendingDeletes:ReadonlySet<string>):Weight[]{
  const rows=new Map<string,Weight>();
  for(const weight of paged)rows.set(weight.id,weight);
  for(const weight of projected)rows.set(weight.id,weight);
  return [...rows.values()]
    .filter(weight=>!weight.deleted&&!pendingDeletes.has(weight.id))
    .sort((a,b)=>b.date.localeCompare(a.date));
}
