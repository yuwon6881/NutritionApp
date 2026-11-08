import {useEffect,useState} from 'react';
import {motionTiming,useReducedMotion} from './Motion';

/**
 * Returns true for the shared exit duration after `active` turns false, so an element can play its
 * exit animation before it unmounts. It never delays anything while `active` is true, and reduced
 * motion removes the linger altogether.
 */
export function useLingering(active:boolean):boolean{
  const reduced=useReducedMotion();
  const [prevActive,setPrevActive]=useState(active);
  const [lingering,setLingering]=useState(false);

  if(active!==prevActive){
    setPrevActive(active);
    if(!active&&prevActive&&!reduced){
      setLingering(true);
    }else{
      setLingering(false);
    }
  }

  useEffect(()=>{
    if(!lingering)return;
    const timer=window.setTimeout(()=>setLingering(false),motionTiming('--motion-exit',180).duration);
    return()=>window.clearTimeout(timer);
  },[lingering]);

  return lingering;
}
