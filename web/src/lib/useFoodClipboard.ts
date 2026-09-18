import {useState,useCallback,useEffect} from 'react';
import type {Entry,Mutation} from '../types';

export interface FoodClipboard {
  sourceDate:string;
  entries:Entry[];
}

const STORAGE_KEY='nutrition_food_clipboard';

function readClipboardStorage():FoodClipboard|null{
  if(typeof window==='undefined')return null;
  try{
    const item=sessionStorage.getItem(STORAGE_KEY);
    if(!item)return null;
    const parsed=JSON.parse(item) as FoodClipboard;
    if(Array.isArray(parsed.entries)&&typeof parsed.sourceDate==='string'&&parsed.entries.length>0){
      return parsed;
    }
  }catch{}
  return null;
}

function writeClipboardStorage(data:FoodClipboard|null){
  if(typeof window==='undefined')return;
  try{
    if(data&&data.entries.length>0){
      sessionStorage.setItem(STORAGE_KEY,JSON.stringify(data));
    }else{
      sessionStorage.removeItem(STORAGE_KEY);
    }
  }catch{}
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
  const [clipboard,setClipboard]=useState<FoodClipboard|null>(()=>readClipboardStorage());

  const copy=useCallback((entries:Entry[],sourceDate:string)=>{
    if(!entries.length)return;
    const next:FoodClipboard={
      sourceDate,
      entries:entries.map(e=>({...e})),
    };
    setClipboard(next);
    writeClipboardStorage(next);
  },[]);

  const clear=useCallback(()=>{
    setClipboard(null);
    writeClipboardStorage(null);
  },[]);

  // Sync state if another tab or component changed storage
  useEffect(()=>{
    const handleStorage=(e:StorageEvent)=>{
      if(e.key===STORAGE_KEY){
        setClipboard(readClipboardStorage());
      }
    };
    window.addEventListener('storage',handleStorage);
    return()=>window.removeEventListener('storage',handleStorage);
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
