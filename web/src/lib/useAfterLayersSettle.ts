import {useCallback,useEffect,useRef,useState} from 'react';
import {backCoordinator} from './appHistory';

/**
 * Defers `run` until the layers dismissed in the same update (selection mode, popovers) have
 * finished leaving history. Opening a dialog earlier lets their pending Back pop the dialog's
 * own history entry, which closes it immediately. Call the returned function after dismissing.
 */
export function useAfterLayersSettle<T>(run:(value:T)=>void){
  const [pending,setPending]=useState<{value:T}|null>(null);
  const runRef=useRef(run);
  useEffect(()=>{runRef.current=run;},[run]);
  // Layer cleanups run before this effect in the same commit, so any guard removal is already pending.
  useEffect(()=>{
    if(!pending)return;
    backCoordinator().afterLayersSettle(()=>runRef.current(pending.value));
    setPending(null);
  },[pending]);
  return useCallback((value:T)=>setPending({value}),[]);
}
