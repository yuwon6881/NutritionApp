import {useMemo} from 'react';
import type {NutritionStore} from '../../useNutritionStore';
import type {ProgressPeriod,ProgressSummary} from '../../types';
import {today} from '../../lib/format';
import {projectProgressWeightSummary,projectedProgressRange} from '../../lib/progress';
import {useProgressSummary} from '../../useProgressSummary';

/**
 * The weight summary for a period with queued weigh-ins projected onto it, so an edit made offline
 * is visible at once. Before the server answers, retained weigh-ins build a summary of their own.
 */
export type WeightProgress=ReturnType<typeof useWeightProgress>;

export function useWeightProgress(store:NutritionStore,period:ProgressPeriod){
  const weight=useProgressSummary(store,period);
  const state=store.state!;
  const queue=store.local?.queue??[];
  const localToday=today(state.profile?.timeZone);
  const displayedPeriod=weight.displayedPeriod;
  const range=useMemo(()=>projectedProgressRange(displayedPeriod,localToday,weight.summary,state.weights,queue),
    [displayedPeriod,localToday,weight.summary,state.weights,queue]);
  const projected=useMemo(()=>projectProgressWeightSummary(range,weight.summary?.weight,queue,state.weights),
    [range,weight.summary?.weight,queue,state.weights]);
  const summary:ProgressSummary|undefined=useMemo(()=>{
    if(weight.summary&&projected){
      return {...weight.summary,start:range.start,end:range.end,weight:projected,
        awaitingSynchronization:projected.statistics.trendPending||weight.summary.awaitingSynchronization};
    }
    if(!weight.summary&&projected){
      return {
        period:displayedPeriod,start:range.start,end:range.end,revision:state.revision,
        grouping:{weight:'daily',energy:'daily'},weight:projected,
        energy:{statistics:{days:0,loggedDays:0,completeDays:0,totalIntake:null,averageIntake:null,averageMaintenance:null,totalBalance:null,surplusDays:0,deficitDays:0},series:[]},
        awaitingSynchronization:true
      };
    }
    return weight.summary;
  },[weight.summary,projected,displayedPeriod,range.start,range.end,state.revision]);
  return {summary,error:weight.error,loading:weight.loading,retry:weight.retry};
}
