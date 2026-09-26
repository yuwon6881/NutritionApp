import {useEffect,useRef} from 'react';
import type {FoodSearchResult} from '../types';
import {api} from '../lib/api';

/** Wait for a pause in typing: food search shares one paced provider quota with every user. */
export const TYPEAHEAD_DELAY_MS=800;
export const TYPEAHEAD_MIN_LENGTH=3;

export function typeaheadQuery(query:string):string|null{
  const trimmed=query.trim();
  return trimmed.length>=TYPEAHEAD_MIN_LENGTH&&trimmed.length<=100?trimmed:null;
}

/**
 * Searches after the person pauses typing. Quiet by design: no busy state and
 * no error message — the explicit Search action still reports failures — and
 * a repeated query is answered from memory instead of spending another call.
 */
export function useSearchAsYouType({enabled,query,onResults}:{
  enabled:boolean;
  query:string;
  onResults:(results:FoodSearchResult[])=>void;
}){
  const cache=useRef(new Map<string,FoodSearchResult[]>());
  const onResultsRef=useRef(onResults);
  useEffect(()=>{onResultsRef.current=onResults;});

  useEffect(()=>{
    const value=enabled?typeaheadQuery(query):null;
    if(!value)return;
    const key=value.toLowerCase();
    const cached=cache.current.get(key);
    if(cached){onResultsRef.current(cached);return;}
    const controller=new AbortController();
    const timer=window.setTimeout(()=>{
      void api<FoodSearchResult[]>('/foods/search?q='+encodeURIComponent(value),undefined,'GET',{signal:controller.signal})
        .then(results=>{
          cache.current.set(key,results);
          if(!controller.signal.aborted)onResultsRef.current(results);
        })
        .catch(()=>{/* Typeahead is best-effort; an explicit search reports errors. */});
    },TYPEAHEAD_DELAY_MS);
    return()=>{window.clearTimeout(timer);controller.abort();};
  },[enabled,query]);
}
