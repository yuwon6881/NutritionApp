import {useState,useEffect,useCallback} from 'react';
import type {AiFood,Nutrients,PortionBasis,Portion} from './types';
import {api,ApiError} from './lib/api';
import {
  type BasketLine,
  lineKey,
  lineFromPer100,
  lineFromAi,
} from './lib/foodBasket';
import {
  type ScanQueueState,
  type ScanOutcome,
  initialQueueState,
  enqueue,
  nextCode,
  begin,
  settle,
  waitMs,
} from './lib/scanQueue';
import {rescaleNutrients} from './lib/nutrients';

type SearchResult = Nutrients & {servingGrams: number;portions?:Portion[]};

export function useFoodBasket(open:boolean){
  const [lines,setLines]=useState<BasketLine[]>([]);
  const [queue,setQueue]=useState<ScanQueueState>(initialQueueState);
  const [scanIds,setScanIds]=useState<string[]>([]);
  const [tick,setTick]=useState(0);

  useEffect(()=>{
    if(!open){
      setLines([]);
      setQueue(initialQueueState());
      setScanIds([]);
      setTick(0);
    }
  },[open]);

  useEffect(()=>{
    let cancelled=false;
    const now=Date.now();
    const code=nextCode(queue,now);

    if(code){
      setQueue(current=>begin(current,code,now));
      (async()=>{
        try{
          const food=await api<SearchResult>('/foods/barcode/'+encodeURIComponent(code));
          if(!cancelled){
            setQueue(current=>settle(current,code,{status:'added',name:food.name},Date.now()));
            setLines(current=>{
              const line=lineFromPer100(food);
              return current.some(l=>l.key===line.key)?current:[...current,line];
            });
          }
        }catch(ex){
          const err=ex as ApiError;
          const status=err.status;
          let outcome:ScanOutcome;
          if(status===404){
            outcome={status:'not-found',message:err.message||'Barcode not found.'};
          }else if(status===422){
            outcome={status:'no-calories',message:err.message||'No calorie data reported.'};
          }else if(status===429){
            outcome={status:'rate-limited',message:err.message||'Rate limited. Retrying…'};
          }else{
            outcome={status:'failed',message:err.message||'Lookup failed.'};
          }
          if(!cancelled){
            setQueue(current=>settle(current,code,outcome,Date.now()));
          }
        }
      })();
      return()=>{cancelled=true;};
    }

    const delay=waitMs(queue,now);
    if(delay>0&&queue.items.some(i=>i.status==='queued'||i.status==='rate-limited')){
      const timer=window.setTimeout(()=>{
        if(!cancelled)setTick(t=>t+1);
      },delay+20);
      return()=>{
        cancelled=true;
        clearTimeout(timer);
      };
    }
  },[queue,tick]);

  const addLine=useCallback((line:BasketLine)=>{
    setLines(current=>current.some(l=>l.key===line.key)?current:[...current,line]);
  },[]);

  const removeLine=useCallback((key:string)=>{
    setLines(current=>current.filter(l=>l.key!==key));
  },[]);

  const updateLineQuantity=useCallback((key:string,quantity:number)=>{
    setLines(current=>current.map(l=>l.key===key?rescaleNutrients(l,{quantity}):l));
  },[]);

  const updateLineBasis=useCallback((key:string,next:Partial<PortionBasis>)=>{
    setLines(current=>current.map(l=>l.key===key?rescaleNutrients(l,next):l));
  },[]);

  const updateLineUnit=useCallback((key:string,unit:'g'|'serving')=>{
    updateLineBasis(key,{unit,portionLabel:unit==='g'?null:undefined,portionGrams:unit==='g'?null:undefined});
  },[updateLineBasis]);

  const toggleItem=useCallback((item:Nutrients&{name:string;source:string})=>{
    const key=lineKey(item.name,item.source);
    setLines(current=>{
      if(current.some(l=>l.key===key)){
        return current.filter(l=>l.key!==key);
      }
      return [...current,lineFromPer100(item)];
    });
  },[]);

  const addAiFoods=useCallback((scanId:string,foods:AiFood[],source='AI estimate · reviewed')=>{
    const newLines=foods.map((f,index)=>({...lineFromAi(f,source),key:`ai:${scanId}:${index}`}));
    setLines(current=>{
      const existingKeys=new Set(current.map(l=>l.key));
      const filtered=newLines.filter(l=>!existingKeys.has(l.key));
      return [...current,...filtered];
    });
    setScanIds(current=>current.includes(scanId)?current:[...current,scanId]);
  },[]);

  const enqueueCode=useCallback((code:string)=>{
    setQueue(current=>enqueue(current,code));
  },[]);

  const clear=useCallback(()=>{
    setLines([]);
    setQueue(initialQueueState());
    setScanIds([]);
  },[]);

  return {
    lines,
    queue,
    scanIds,
    addLine,
    removeLine,
    replaceLine:(key:string,line:BasketLine)=>setLines(current=>current.map(item=>item.key===key?{...line,key}:item)),
    updateLineQuantity,
    updateLineBasis,
    updateLineUnit,
    toggleItem,
    addAiFoods,
    enqueueCode,
    clear,
  };
}

export type FoodBasketHook = ReturnType<typeof useFoodBasket>;
