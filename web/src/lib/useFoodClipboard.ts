import {useState,useCallback} from 'react';
import type {Entry,Mutation} from '../types';

export interface FoodClipboard {
  sourceDate:string;
  entries:Entry[];
}

export interface PasteMutation extends Omit<Mutation,'id'> {
  kind:'entry';
  data:Entry;
}

export function createPasteMutations(
  entries:Entry[],
  targetDate:string,
  targetTime?:string|null
):PasteMutation[]{
  return entries.map(entry=>{
    const time=targetTime!==undefined?targetTime:(entry.time??null);
    return {
      kind:'entry',
      recordId:crypto.randomUUID(),
      expectedRevision:0,
      delete:false,
      data:{
        ...entry,
        id:crypto.randomUUID(),
        date:targetDate,
        time,
      }
    };
  });
}

export function useFoodClipboard(){
  const [clipboard,setClipboard]=useState<FoodClipboard|null>(null);

  const copy=useCallback((entries:Entry[],sourceDate:string)=>{
    if(!entries.length)return;
    setClipboard({
      sourceDate,
      entries:entries.map(e=>({...e})),
    });
  },[]);

  const clear=useCallback(()=>{
    setClipboard(null);
  },[]);

  const count=clipboard?.entries.length??0;
  const totalCalories=clipboard?.entries.reduce((sum,e)=>sum+e.calories,0)??0;

  return {
    clipboard,
    count,
    totalCalories,
    copy,
    clear,
  };
}
