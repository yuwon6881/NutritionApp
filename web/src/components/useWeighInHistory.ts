import {useCallback,useEffect,useRef,useState} from 'react';
import type {Weight} from '../types';
import {api} from '../lib/api';

type WeighInPage={items:Weight[];hasMore:boolean};

const PAGE_SIZE=30;
/** One request's ceiling on the server; a reload of a long list walks several pages. */
const MAX_PAGE=60;

const nextDay=(date:string)=>{
  const value=new Date(`${date}T00:00:00Z`);value.setUTCDate(value.getUTCDate()+1);
  return value.toISOString().slice(0,10);
};

async function readPages(start:string,before:string,wanted:number,signal:AbortSignal):Promise<WeighInPage>{
  const items:Weight[]=[];
  let cursor=before,hasMore=true;
  while(hasMore&&items.length<wanted){
    const limit=Math.min(MAX_PAGE,wanted-items.length);
    const page=await api<WeighInPage>(`/progress/weigh-ins?start=${start}&before=${cursor}&limit=${limit}`,undefined,'GET',{signal});
    items.push(...page.items);
    hasMore=page.hasMore&&page.items.length>0;
    if(page.items.length)cursor=page.items.at(-1)!.date;
  }
  return {items,hasMore};
}

/**
 * Older weigh-ins for the Progress history list, read a page at a time. The summary lists only
 * the latest rows, so the rest of the period is paged backwards by date as the person asks for it.
 * A changed period or saved revision re-reads as many rows as were already shown, so an edit far
 * down the list neither collapses it nor leaves a stale row behind.
 */
export function useWeighInHistory(start:string,end:string,revision:number){
  const [items,setItems]=useState<Weight[]>([]);
  const [hasMore,setHasMore]=useState(true);
  const [loading,setLoading]=useState(false);
  const [error,setError]=useState('');
  const shown=useRef(0);
  const request=useRef<AbortController|null>(null);
  const range=useRef({start,end});
  range.current={start,end};

  const run=useCallback(async(before:string,wanted:number,append:boolean)=>{
    request.current?.abort();
    const controller=new AbortController();
    request.current=controller;
    setLoading(true);setError('');
    try{
      const page=await readPages(range.current.start,before,wanted,controller.signal);
      if(controller.signal.aborted)return;
      setItems(previous=>{
        const next=append?[...previous,...page.items]:page.items;
        shown.current=next.length;
        return next;
      });
      setHasMore(page.hasMore);
    }catch(ex){
      if(!controller.signal.aborted)setError((ex as Error).message||'Older weigh-ins could not be loaded.');
    }finally{
      if(request.current===controller){request.current=null;setLoading(false);}
    }
  },[]);

  // A new period starts collapsed; a new revision of the same period re-reads what was open.
  const periodKey=`${start}:${end}`;
  const lastPeriod=useRef(periodKey);
  useEffect(()=>{
    if(lastPeriod.current!==periodKey){
      lastPeriod.current=periodKey;
      request.current?.abort();
      shown.current=0;
      setItems([]);setHasMore(true);setError('');setLoading(false);
      return;
    }
    if(shown.current>0)void run(nextDay(end),shown.current,false);
  },[periodKey,end,revision,run]);

  useEffect(()=>()=>request.current?.abort(),[]);

  const loadMore=useCallback(()=>{
    if(request.current)return;
    const before=items.length?items.at(-1)!.date:nextDay(range.current.end);
    void run(before,PAGE_SIZE,items.length>0);
  },[items,run]);

  return {items,hasMore,loading,error,loadMore,started:items.length>0||loading};
}
