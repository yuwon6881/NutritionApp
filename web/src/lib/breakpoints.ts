import {useEffect,useState} from 'react';

/**
 * One window-size contract for JavaScript: compact below 640 px, medium from
 * 640 through 1023 px, expanded from 1024 px. CSS uses the matching media
 * queries; pointer type never selects layout.
 */
export const COMPACT_QUERY='(max-width: 639px)';
export const EXPANDED_QUERY='(min-width: 1024px)';

function useMediaQuery(query:string){
  const [matches,setMatches]=useState(()=>
    typeof window!=='undefined'&&typeof window.matchMedia==='function'
      ?window.matchMedia(query).matches
      :false
  );
  useEffect(()=>{
    if(typeof window==='undefined'||typeof window.matchMedia!=='function')return;
    const media=window.matchMedia(query);
    const update=()=>setMatches(media.matches);
    update();
    media.addEventListener('change',update);
    return()=>media.removeEventListener('change',update);
  },[query]);
  return matches;
}

/** True on phone-width screens, where row actions are revealed by swiping. */
export const useIsCompact=()=>useMediaQuery(COMPACT_QUERY);
export const useIsExpanded=()=>useMediaQuery(EXPANDED_QUERY);
