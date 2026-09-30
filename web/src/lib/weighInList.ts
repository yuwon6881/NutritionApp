import type {ProgressWeightPoint} from '../types';

/**
 * Scale change from the closest earlier weigh-in in the chart series, or null
 * when this is the first weigh-in shown. The series spans the whole period,
 * so a row still finds its predecessor when that one is no longer editable.
 */
export function changeSincePrevious(series:readonly ProgressWeightPoint[],date:string,kg:number):number|null{
  let previous:ProgressWeightPoint|undefined;
  for(const point of series){
    if(point.date>=date)break;
    previous=point;
  }
  return previous?kg-previous.scaleKg:null;
}
