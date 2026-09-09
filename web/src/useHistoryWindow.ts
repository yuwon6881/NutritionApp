import {useEffect,useState} from 'react';
import type {Nourish} from './useNourish';
import {historyState} from './lib/history';

export function useHistoryWindow(store:Nourish,key:string,enabled=true){
  const [failure,setFailure]=useState<{key:string;message:string}>();
  const [attempt,setAttempt]=useState(0);
  const refresh=store.refreshHistory;
  const revision=store.local?.state.revision;
  useEffect(()=>{
    if(!enabled)return;
    let active=true;
    const load=()=>void refresh(key).then(()=>{if(active)setFailure(undefined);}).catch(ex=>{if(active)setFailure({key,message:(ex as Error).message});});
    const wake=()=>{if(document.visibilityState==='visible')load();};
    load();window.addEventListener('online',wake);document.addEventListener('visibilitychange',wake);
    return()=>{active=false;window.removeEventListener('online',wake);document.removeEventListener('visibilitychange',wake);};
  },[refresh,key,revision,store.calendarDate,attempt,enabled]);
  return {state:store.local?historyState(store.local,key):undefined,error:failure?.key===key?failure.message:'',retry:()=>setAttempt(n=>n+1)};
}
