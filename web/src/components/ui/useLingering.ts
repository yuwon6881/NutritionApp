import {useEffect,useRef,useState} from 'react';
import {motionTiming,useReducedMotion} from './Motion';

/**
 * Returns true for the shared exit duration after `active` turns false, so an element can play its
 * exit animation before it unmounts. It never delays anything while `active` is true, and reduced
 * motion removes the linger altogether.
 */
export function useLingering(active:boolean):boolean{
  const reduced=useReducedMotion();
  const [lingering,setLingering]=useState(false);
  const wasActive=useRef(active);

  useEffect(()=>{
    const ended=wasActive.current&&!active;
    wasActive.current=active;
    if(active||!ended||reduced){
      setLingering(false);
      return;
    }
    setLingering(true);
    const timer=window.setTimeout(()=>setLingering(false),motionTiming('--motion-exit',180).duration);
    return()=>window.clearTimeout(timer);
  },[active,reduced]);

  return lingering;
}
