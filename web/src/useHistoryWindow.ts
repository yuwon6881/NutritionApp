import {useEffect,useState} from 'react';
import type {Nourish} from './useNourish';
import {historyState} from './lib/history';
import {waitForMinimumDuration} from './lib/async';

const MIN_HISTORY_LOADING_MS=320;

export function useHistoryWindow(store:Nourish,key:string,enabled=true){
  const [failure,setFailure]=useState<{key:string;message:string}>();
  const [loading,setLoading]=useState(enabled);
  const [attempt,setAttempt]=useState(0);
  const refresh=store.refreshHistory;
  const revision=store.local?.state.revision;
  useEffect(()=>{
    if(!enabled){setLoading(false);return;}
    let active=true;
    let sequence=0;
    const load=async()=>{
      const token=++sequence;const startedAt=Date.now();
      if(active){setLoading(true);setFailure(undefined);}
      try{await refresh(key);if(active&&token===sequence)setFailure(undefined);}
      catch(ex){if(active&&token===sequence)setFailure({key,message:(ex as Error).message});}
      finally{await waitForMinimumDuration(startedAt,MIN_HISTORY_LOADING_MS);if(active&&token===sequence)setLoading(false);}
    };
    const wake=()=>{if(document.visibilityState==='visible')load();};
    void load();window.addEventListener('online',wake);document.addEventListener('visibilitychange',wake);
    return()=>{active=false;window.removeEventListener('online',wake);document.removeEventListener('visibilitychange',wake);};
  },[refresh,key,revision,store.calendarDate,attempt,enabled]);
  return {state:store.local?historyState(store.local,key):undefined,error:failure?.key===key?failure.message:'',loading,retry:()=>setAttempt(n=>n+1)};
}
