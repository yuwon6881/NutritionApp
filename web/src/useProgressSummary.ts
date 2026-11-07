import {useCallback,useEffect,useRef,useState} from 'react';
import type {NutritionStore} from './useNutritionStore';
import type {ProgressPeriod,ProgressSummary} from './types';
import {progressDataKey} from './lib/progressFreshness';

/** The server's progress summary for one period, retained while a different period loads. */
export function useProgressSummary(store:NutritionStore,period:ProgressPeriod,enabled=true){
  const [error,setError]=useState('');
  const cached=store.local?.progress?.[period];
  const [retained,setRetained]=useState<ProgressSummary|undefined>(cached);
  useEffect(()=>{
    if(cached)setRetained(cached);
  },[cached]);
  const activeSummary=cached??retained;
  const isFetching=!cached&&enabled;
  const [loading,setLoading]=useState(isFetching);
  const cachedRef=useRef(cached);
  cachedRef.current=cached;
  const refreshProgress=store.refreshProgress;
  const load=useCallback(async()=>{
    if(!enabled)return;
    if(!cachedRef.current)setLoading(true);
    setError('');
    try{await refreshProgress(period);}catch(ex){setError((ex as Error).message);}
    finally{setLoading(false);}
  },[enabled,period,refreshProgress]);
  const revision=progressDataKey(store.local?.state);
  useEffect(()=>{void load();},[load,revision,store.calendarDate]);
  return {
    summary:activeSummary,
    displayedPeriod:cached?period:(retained?.period??period),
    error,
    loading:loading||isFetching,
    retry:load
  };
}
