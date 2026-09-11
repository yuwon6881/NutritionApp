import {useCallback,useEffect,useRef,useState} from 'react';

const DEFAULT_DELAY_MS=300;

/**
 * Separates actual pending state from visual feedback.
 * Actions resolve immediately upon completion without artificial delays.
 * Duplicate actions are blocked immediately while in flight.
 * Visual busy feedback is delayed by 300 ms to prevent flickering on fast completions.
 */
export function useAsyncAction(delayMs=DEFAULT_DELAY_MS){
  const [busy,setBusy]=useState(false);
  const [pending,setPending]=useState(false);
  const mounted=useRef(true);
  const inFlight=useRef(false);
  const activePromise=useRef<Promise<unknown>|undefined>(undefined);
  const runId=useRef(0);
  const timer=useRef<ReturnType<typeof setTimeout>|undefined>(undefined);

  const clearTimer=useCallback(()=>{
    if(timer.current!==undefined){
      clearTimeout(timer.current);
      timer.current=undefined;
    }
  },[]);

  useEffect(()=>{
    mounted.current=true;
    return ()=>{
      mounted.current=false;
      clearTimer();
      inFlight.current=false;
      activePromise.current=undefined;
    };
  },[clearTimer]);

  const reset=useCallback(()=>{
    clearTimer();
    inFlight.current=false;
    activePromise.current=undefined;
    ++runId.current;
    if(mounted.current){
      setPending(false);
      setBusy(false);
    }
  },[clearTimer]);

  const run=useCallback(async<T>(action:()=>Promise<T>):Promise<T>=>{
    if(inFlight.current&&activePromise.current){
      return activePromise.current as Promise<T>;
    }
    inFlight.current=true;
    const id=++runId.current;
    if(mounted.current)setPending(true);

    clearTimer();
    timer.current=setTimeout(()=>{
      timer.current=undefined;
      if(mounted.current&&id===runId.current&&inFlight.current){
        setBusy(true);
      }
    },delayMs);

    const promise=(async()=>{
      try{
        return await action();
      }finally{
        clearTimer();
        inFlight.current=false;
        activePromise.current=undefined;
        if(mounted.current&&id===runId.current){
          setPending(false);
          setBusy(false);
        }
      }
    })();

    activePromise.current=promise;
    return promise;
  },[clearTimer,delayMs]);

  return {busy,pending,run,reset};
}
