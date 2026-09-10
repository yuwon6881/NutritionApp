import {useCallback,useEffect,useRef,useState} from 'react';
import {waitForMinimumDuration} from '../../lib/async';

const DEFAULT_MINIMUM_VISIBLE_MS=420;

/**
 * Keeps a transient action state readable when the underlying work completes
 * before the browser has painted it. The action still resolves as soon as the
 * minimum visual dwell has elapsed, so callers can close a dialog afterwards.
 */
export function useAsyncAction(minimumVisibleMs=DEFAULT_MINIMUM_VISIBLE_MS){
  const [busy,setBusy]=useState(false);
  const mounted=useRef(true);
  const runId=useRef(0);

  useEffect(()=>()=>{
    mounted.current=false;
    ++runId.current;
  },[]);

  const run=useCallback(async<T>(action:()=>Promise<T>):Promise<T>=>{
    const id=++runId.current;
    const startedAt=Date.now();
    if(mounted.current)setBusy(true);
    try{
      return await action();
    }finally{
      await waitForMinimumDuration(startedAt,minimumVisibleMs);
      if(mounted.current&&id===runId.current)setBusy(false);
    }
  },[minimumVisibleMs]);

  const reset=useCallback(()=>{
    ++runId.current;
    if(mounted.current)setBusy(false);
  },[]);

  return {busy,run,reset};
}
