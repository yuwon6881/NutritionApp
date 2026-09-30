import {useEffect,useState} from 'react';
import {EXPANDED_MIN_WIDTH,MEDIUM_MIN_WIDTH,windowTier,type WindowTier} from '../../lib/breakpoints';

const current=():WindowTier=>typeof window==='undefined'?'expanded':windowTier(window.innerWidth);

/** The shared compact/medium/expanded tier, updated when the window crosses a breakpoint. */
export function useWindowTier():WindowTier{
  const [tier,setTier]=useState(current);
  useEffect(()=>{
    if(!window.matchMedia)return;
    const queries=[MEDIUM_MIN_WIDTH,EXPANDED_MIN_WIDTH].map(width=>window.matchMedia(`(min-width:${width}px)`));
    const update=()=>setTier(current());
    queries.forEach(query=>query.addEventListener('change',update));
    update();
    return()=>queries.forEach(query=>query.removeEventListener('change',update));
  },[]);
  return tier;
}
