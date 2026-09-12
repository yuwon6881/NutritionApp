import {useState,useEffect,useCallback} from 'react';
import type {AiFood,Nutrients,PortionBasis} from './types';
import {
  type BasketLine,
  lineKey,
  lineFromPer100,
  lineFromAi,
} from './lib/foodBasket';
import {rescaleNutrients} from './lib/nutrients';

export function useFoodBasket(open:boolean){
  const [lines,setLines]=useState<BasketLine[]>([]);
  const [scanIds,setScanIds]=useState<string[]>([]);

  useEffect(()=>{
    if(!open){
      setLines([]);
      setScanIds([]);
    }
  },[open]);

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

  const clear=useCallback(()=>{
    setLines([]);
    setScanIds([]);
  },[]);

  return {
    lines,
    scanIds,
    addLine,
    removeLine,
    replaceLine:(key:string,line:BasketLine)=>setLines(current=>current.map(item=>item.key===key?{...line,key}:item)),
    updateLineQuantity,
    updateLineBasis,
    updateLineUnit,
    toggleItem,
    addAiFoods,
    clear,
  };
}

export type FoodBasketHook = ReturnType<typeof useFoodBasket>;
