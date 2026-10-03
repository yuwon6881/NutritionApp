import type {ProgressWeightPoint} from '../types';

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
