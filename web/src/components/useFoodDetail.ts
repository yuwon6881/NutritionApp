import {useEffect,useRef,useState} from 'react';
import type {FoodSearchResult} from '../types';
import {barcodeValue} from '../lib/logFood';

export interface FoodDetailState {
  food:FoodSearchResult;
  error?:string;
}

/** Resolve an unconfirmed selection without letting a late response reopen a departed review. */
export function useFoodDetail({enabled,resolve,onResolved}:{
  enabled:boolean;
  resolve:(code:string,signal:AbortSignal)=>Promise<FoodSearchResult>;
  onResolved:(food:FoodSearchResult)=>void;
}){
  const [detail,setDetail]=useState<FoodDetailState|null>(null);
  const request=useRef<AbortController|null>(null);
  const handlers=useRef({resolve,onResolved});
  handlers.current={resolve,onResolved};

  const cancel=()=>{
    request.current?.abort();
    request.current=null;
    setDetail(null);
  };

  const load=async(food:FoodSearchResult)=>{
    request.current?.abort();
    const controller=new AbortController();
    request.current=controller;
    setDetail({food});
    try{
      const code=barcodeValue(food.code);
      if(!code)throw new Error('This result has no usable barcode. Choose another food or enter its label manually.');
      const confirmed=await handlers.current.resolve(code,controller.signal);
      if(controller.signal.aborted||request.current!==controller)return;
      if(confirmed.basis!=='per100g')throw new Error('The nutrition quantity could not be confirmed. Enter the values from the label or try another food.');
      request.current=null;
      handlers.current.onResolved(confirmed);
    }catch(error){
      if(controller.signal.aborted||request.current!==controller)return;
      request.current=null;
      setDetail({food,error:error instanceof Error?error.message:'Nutrition is unavailable. Try again.'});
    }
  };

  useEffect(()=>{
    if(!enabled)cancel();
  },[enabled]);
  useEffect(()=>()=>{request.current?.abort();request.current=null;},[]);

  return {detail,load,cancel};
}
