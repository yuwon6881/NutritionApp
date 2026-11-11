import {useCallback,useEffect,useRef,useState} from 'react';
import {backCoordinator} from './appHistory';
import {motionTiming,useReducedMotion} from '../components/ui/Motion';

/**
 * Defers `run` until the layers dismissed in the same update (selection mode, popovers) have
 * finished leaving history and their exit animations have finished. Opening a dialog earlier lets
 * their pending Back pop the dialog's own history entry (closing it immediately) and causes main-thread
 * rendering stutter during the dismiss transition. Call the returned function after dismissing.
 *
 * `waitForExit: false` skips the animation wait for a caller that holds the dismissed layer still
 * until the dialog covers it, so the dialog opens as soon as history allows.
 */
export function useAfterLayersSettle<T>(run:(value:T)=>void,{waitForExit=true}:{waitForExit?:boolean}={}){
  const reduced=useReducedMotion();
  const [pending,setPending]=useState<{value:T;queuedAt:number}|null>(null);
  const runRef=useRef(run);
  const timerRef=useRef<number|null>(null);

  useEffect(()=>{runRef.current=run;},[run]);
  useEffect(()=>()=>{
    if(timerRef.current)window.clearTimeout(timerRef.current);
  },[]);

  // Layer cleanups run before this effect in the same commit, so any guard removal is already pending.
  useEffect(()=>{
    if(!pending||typeof window==='undefined')return;
    const {value,queuedAt}=pending;
    setPending(null);
    backCoordinator().afterLayersSettle(()=>{
      const targetDuration=reduced||!waitForExit?0:motionTiming('--motion-exit',180).duration;
      const elapsed=Date.now()-queuedAt;
      const remaining=Math.max(0,targetDuration-elapsed);
      if(remaining===0){
        runRef.current(value);
      }else{
        timerRef.current=window.setTimeout(()=>{
          timerRef.current=null;
          runRef.current(value);
        },remaining);
      }
    });
  },[pending,reduced,waitForExit]);
  return useCallback((value:T)=>setPending({value,queuedAt:Date.now()}),[]);
}
