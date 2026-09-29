import {useEffect,useState} from 'react';
import {useReducedMotion} from './Motion';

/** Ease-out cubic: fast start, gentle settle. */
export function easeOutCubic(t:number){
  const clamped=Math.min(Math.max(t,0),1);
  return 1-Math.pow(1-clamped,3);
}

/**
 * A one-shot 0→1 progress clock for decorative entrance motion. Returns 1 at
 * once when disabled or when the person prefers reduced motion. Callers must
 * keep the true value in text or accessible names; only visuals follow this.
 */
export function useIntroProgress(enabled:boolean,duration=900,delay=160){
  const reduced=useReducedMotion();
  const active=enabled&&!reduced;
  const [progress,setProgress]=useState(active?0:1);
  useEffect(()=>{
    if(!active){setProgress(1);return;}
    let frame=0;
    const start=performance.now()+delay;
    const tick=(now:number)=>{
      const t=(now-start)/duration;
      setProgress(easeOutCubic(t));
      if(t<1)frame=requestAnimationFrame(tick);
    };
    frame=requestAnimationFrame(tick);
    return()=>{cancelAnimationFrame(frame);setProgress(1);};
  },[active,duration,delay]);
  return progress;
}
