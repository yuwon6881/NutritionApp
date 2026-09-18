import {useState,useCallback,useEffect} from 'react';

export interface FoodSelectionState {
  selectedIds:Set<string>;
  isSelecting:boolean;
  enterSelection:(initialId?:string)=>void;
  exitSelection:()=>void;
  toggle:(id:string)=>void;
  select:(id:string)=>void;
  selectAll:(ids:string[])=>void;
  deselectAll:()=>void;
  isSelected:(id:string)=>boolean;
}

export function useFoodSelection():FoodSelectionState{
  const [selectedIds,setSelectedIds]=useState<Set<string>>(()=>new Set());
  const [isSelecting,setIsSelecting]=useState(false);

  const enterSelection=useCallback((initialId?:string)=>{
    setIsSelecting(true);
    if(initialId){
      setSelectedIds(new Set([initialId]));
    }
  },[]);

  const exitSelection=useCallback(()=>{
    setIsSelecting(false);
    setSelectedIds(new Set());
  },[]);

  const toggle=useCallback((id:string)=>{
    setSelectedIds(prev=>{
      const next=new Set(prev);
      if(next.has(id)){
        next.delete(id);
      }else{
        next.add(id);
      }
      return next;
    });
  },[]);

  const select=useCallback((id:string)=>{
    setSelectedIds(prev=>new Set(prev).add(id));
  },[]);

  const selectAll=useCallback((ids:string[])=>{
    setSelectedIds(new Set(ids));
  },[]);

  const deselectAll=useCallback(()=>{
    setSelectedIds(new Set());
  },[]);

  const isSelected=useCallback((id:string)=>selectedIds.has(id),[selectedIds]);

  useEffect(()=>{
    if(!isSelecting)return;
    const handleKeyDown=(e:KeyboardEvent)=>{
      if(e.key==='Escape'){
        exitSelection();
      }
    };
    window.addEventListener('keydown',handleKeyDown);
    return()=>window.removeEventListener('keydown',handleKeyDown);
  },[isSelecting,exitSelection]);

  return {
    selectedIds,
    isSelecting,
    enterSelection,
    exitSelection,
    toggle,
    select,
    selectAll,
    deselectAll,
    isSelected,
  };
}
