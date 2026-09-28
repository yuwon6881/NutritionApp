import {useLayoutEffect} from 'react';

/** Let opt-in diagnostics observe the first live frame without delaying interaction. */
export function useOpeningFrame(open:boolean,onReady?:()=>void){
  useLayoutEffect(()=>{
    if(!open)return;
    const frame=requestAnimationFrame(()=>onReady?.());
    return()=>cancelAnimationFrame(frame);
  },[open,onReady]);
}
