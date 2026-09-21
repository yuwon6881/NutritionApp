import {useState,useEffect,useCallback,useRef} from 'react';
import type {AiFood,Nutrients,PortionBasis} from './types';
import {
  type BasketLine,
  lineKey,
  aiFoodLineKey,
  lineFromPer100,
  lineFromAi,
} from './lib/foodBasket';
import {rescaleNutrients} from './lib/nutrients';
import {foodBasketDraftKey,isFoodBasketDraftKeyLoaded,readFoodBasketDraft,saveFoodBasketDraft} from './lib/local';

export function useFoodBasket(open:boolean,user:string,date:string){
  const [lines,setLines]=useState<BasketLine[]>([]);
  const [ready,setReady]=useState(false);
  const [writable,setWritable]=useState(false);
  const [storageError,setStorageError]=useState('');
  const [loadedKey,setLoadedKey]=useState<string|null>(null);
  const linesRef=useRef(lines);
  const draftWrites=useRef(Promise.resolve());
  const commitLines=useCallback((update:(current:BasketLine[])=>BasketLine[])=>{
    const next=update(linesRef.current);
    linesRef.current=next;
    setLines(next);
    return next;
  },[]);

  useEffect(()=>{
    if(!open)return;
    let current=true;
    const key=foodBasketDraftKey(user,date);
    setReady(false);
    setWritable(false);
    setLoadedKey(null);
    setStorageError('');
    linesRef.current=[];
    setLines([]);
    void readFoodBasketDraft(user,date).then(saved=>{
      if(current){linesRef.current=saved;setLines(saved);setWritable(true);setLoadedKey(key);}
    }).catch(()=>{
      if(current){linesRef.current=[];setLines([]);setStorageError('This device could not restore the unfinished food batch. Keep this screen open until it is logged.');}
    }).finally(()=>{
      if(current)setReady(true);
    });
    return()=>{current=false;};
  },[open,user,date]);

  const persistLines=useCallback(async(next:BasketLine[])=>{
    if(!ready||!writable||!isFoodBasketDraftKeyLoaded(loadedKey,user,date))
      throw new Error('The unfinished food batch is not ready to save on this device.');
    const write=draftWrites.current.catch(()=>undefined).then(()=>saveFoodBasketDraft(user,date,next));
    draftWrites.current=write;
    try{
      await write;
      setStorageError('');
    }catch(error){
      setStorageError('The unfinished food batch could not be saved on this device. Keep this screen open until it is logged.');
      throw error;
    }
  },[loadedKey,ready,user,date,writable]);

  const updateLinesDurably=useCallback(async(update:(current:BasketLine[])=>BasketLine[])=>{
    if(!ready||!writable||!isFoodBasketDraftKeyLoaded(loadedKey,user,date))
      throw new Error('The unfinished food batch is not ready to save on this device.');
    const write=draftWrites.current.catch(()=>undefined).then(async()=>{
      const next=update(linesRef.current);
      await saveFoodBasketDraft(user,date,next);
      commitLines(()=>next);
    });
    draftWrites.current=write;
    try{
      await write;
      setStorageError('');
      return linesRef.current;
    }catch(error){
      setStorageError('The unfinished food batch could not be saved on this device. Keep this screen open until it is logged.');
      throw error;
    }
  },[commitLines,loadedKey,ready,user,date,writable]);

  const addLine=useCallback((line:BasketLine)=>updateLinesDurably(current=>current.some(item=>item.key===line.key)?current:[...current,line]),[updateLinesDurably]);

  const persistLine=useCallback(async(line:BasketLine)=>{
    await updateLinesDurably(current=>current.some(item=>item.key===line.key)?current:[...current,line]);
  },[updateLinesDurably]);

  const removeLine=useCallback((key:string)=>updateLinesDurably(current=>current.filter(item=>item.key!==key)),[updateLinesDurably]);

  const updateLineQuantity=useCallback((key:string,quantity:number)=>updateLinesDurably(current=>current.map(item=>item.key===key?rescaleNutrients(item,{quantity}):item)),[updateLinesDurably]);

  const updateLineBasis=useCallback((key:string,next:Partial<PortionBasis>)=>updateLinesDurably(current=>current.map(item=>item.key===key?rescaleNutrients(item,next):item)),[updateLinesDurably]);

  const updateLineUnit=useCallback((key:string,unit:'g'|'serving')=>{
    return updateLineBasis(key,{unit,portionLabel:unit==='g'?null:undefined,portionGrams:unit==='g'?null:undefined});
  },[updateLineBasis]);

  const toggleItem=useCallback((item:Nutrients&{name:string;source:string})=>updateLinesDurably(current=>{
    const key=lineKey(item.name,item.source);
    return current.some(line=>line.key===key)
      ?current.filter(line=>line.key!==key)
      :[...current,lineFromPer100(item)];
  }),[updateLinesDurably]);

  const addAiFoods=useCallback(async(foods:AiFood[],source='AI estimate',operationId:string=crypto.randomUUID())=>{
    const newLines=foods.map((food,index)=>({...lineFromAi(food,source),key:aiFoodLineKey(operationId,index)}));
    await updateLinesDurably(current=>{
      const existingKeys=new Set(current.map(line=>line.key));
      return [...current,...newLines.filter(line=>!existingKeys.has(line.key))];
    });
  },[updateLinesDurably]);

  const replaceLine=useCallback((key:string,line:BasketLine)=>updateLinesDurably(current=>current.map(item=>item.key===key?{...line,key}:item)),[updateLinesDurably]);
  const clear=useCallback(()=>updateLinesDurably(()=>[]),[updateLinesDurably]);
  const clearAfterOutboxCommit=useCallback(()=>{
    linesRef.current=[];
    setLines([]);
    setStorageError('');
  },[]);
  const flush=useCallback(()=>draftWrites.current,[]);
  const retrySave=useCallback(()=>persistLines(linesRef.current),[persistLines]);

  return {
    lines,
    ready,
    storageError,
    flush,
    retrySave,
    addLine,
    addLineDurably:persistLine,
    removeLine,
    replaceLine,
    updateLineQuantity,
    updateLineBasis,
    updateLineUnit,
    toggleItem,
    addAiFoods,
    clear,
    clearAfterOutboxCommit,
  };
}

export type FoodBasketHook = ReturnType<typeof useFoodBasket>;
