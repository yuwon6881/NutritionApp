import {useCallback,useEffect,useRef,useState,type RefObject} from 'react';
import type {FoodSearchResult} from '../types';
import {api} from '../lib/api';
import {applyVerifiedFoods,verifiableCodes,VERIFYING_PROVIDER} from '../lib/foodVerification';

/** Wait for a pause in typing: food search shares one paced provider quota with every user. */
export const TYPEAHEAD_DELAY_MS=800;
export const TYPEAHEAD_MIN_LENGTH=3;

export function typeaheadQuery(query:string):string|null{
  const trimmed=query.trim();
  return trimmed.length>=TYPEAHEAD_MIN_LENGTH&&trimmed.length<=100?trimmed:null;
}

/**
 * Searches after the person pauses typing; this is the only search trigger
 * besides the keyboard's search key, so a failure is reported through
 * `onError` rather than leaving an empty list. `searching` is true only while a
 * request for the current query is in flight, and a repeated query is answered
 * from memory instead of spending another call. An owner that outlives the
 * search panel passes `cache` so returning to the panel spends no call either.
 */
export type SearchCache=RefObject<Map<string,FoodSearchResult[]>>;

export function useSearchAsYouType({enabled,query,onResults,onError,cache:sharedCache}:{
  enabled:boolean;
  query:string;
  onResults:(results:FoodSearchResult[])=>void;
  onError?:(message:string)=>void;
  cache?:SearchCache;
}){
  const ownCache=useRef(new Map<string,FoodSearchResult[]>());
  const cache=sharedCache??ownCache;
  // The key of the request in flight; comparing it with the current query keeps a superseded
  // request from showing as the current one.
  const [inFlight,setInFlight]=useState<string|null>(null);
  const requests=useRef(new Map<string,{controller:AbortController;promise:Promise<FoodSearchResult[]>}>());
  // The query on screen, so a confirmation that lands after the person moved on only updates memory.
  const shownKey=useRef('');
  const onResultsRef=useRef(onResults);
  // Rows the search returned before Open Food Facts confirmed their basis are confirmed in one
  // follow-up read and filled in place; a failure leaves them as "loads when opened".
  const confirm=useCallback((key:string,results:FoodSearchResult[])=>{
    const codes=verifiableCodes(results);
    if(codes.length===0)return;
    void api<FoodSearchResult[]>(`/foods/verify?provider=${VERIFYING_PROVIDER}&codes=${codes.join(',')}`)
      .then(verified=>{
        const current=cache.current.get(key)??results;
        const next=applyVerifiedFoods(current,verified);
        if(next.every((row,index)=>row===current[index]))return;
        cache.current.set(key,next);
        if(shownKey.current===key)onResultsRef.current(next);
      })
      .catch(()=>{/* confirmation is an improvement; the unconfirmed rows still open normally */});
  },[cache]);
  const search=useCallback((value:string)=>{
    const key=value.trim().toLowerCase();
    const cached=cache.current.get(key);
    if(cached)return Promise.resolve(cached);
    const existing=requests.current.get(key);
    if(existing)return existing.promise;
    const controller=new AbortController();
    const promise=api<FoodSearchResult[]>('/foods/search?q='+encodeURIComponent(value.trim()),undefined,'GET',{signal:controller.signal})
      .then(results=>{
        if(!controller.signal.aborted){
          cache.current.set(key,results);
          if(cache.current.size>64)cache.current.delete(cache.current.keys().next().value!);
          confirm(key,results);
        }
        return results;
      }).finally(()=>{if(requests.current.get(key)?.promise===promise)requests.current.delete(key);});
    requests.current.set(key,{controller,promise});
    return promise;
  },[cache,confirm]);
  const onErrorRef=useRef(onError);
  useEffect(()=>{onResultsRef.current=onResults;onErrorRef.current=onError;});

  useEffect(()=>{
    const key=query.trim().toLowerCase();
    shownKey.current=enabled?key:'';
    for(const [pending,request] of requests.current){
      if(!enabled||pending!==key){request.controller.abort();requests.current.delete(pending);}
    }
    const value=enabled?typeaheadQuery(query):null;
    if(!value){
      if(enabled&&query.trim().length<TYPEAHEAD_MIN_LENGTH){
        onResultsRef.current([]);
      }
      return;
    }
    const cached=cache.current.get(key);
    if(cached){onResultsRef.current(cached);return;}
    let active=true;
    const timer=window.setTimeout(()=>{
      setInFlight(key);
      void search(value)
        .then(results=>{
          if(active)onResultsRef.current(results);
        })
        .catch((error:unknown)=>{
          // A superseded request aborts on purpose; only a live query's failure is news.
          if(!active||(error instanceof DOMException&&error.name==='AbortError'))return;
          onErrorRef.current?.(error instanceof Error?error.message:'Food search is unavailable. Try again.');
        })
        .finally(()=>setInFlight(current=>current===key?null:current));
    },TYPEAHEAD_DELAY_MS);
    return()=>{active=false;window.clearTimeout(timer);};
  },[enabled,query,search]);
  useEffect(()=>()=>{for(const request of requests.current.values())request.controller.abort();requests.current.clear();},[]);
  const searching=enabled&&inFlight!==null&&inFlight===query.trim().toLowerCase();
  return {search,searching};
}
