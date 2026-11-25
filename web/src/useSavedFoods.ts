import {useCallback,useRef,type RefObject} from 'react';
import type {Food,LocalData} from './types';
import {type SavedFoodsCache} from './lib/savedFoods';

export function useSavedFoods(user:string,ref:RefObject<LocalData|undefined>,alive:RefObject<boolean>,foodsEtag:RefObject<string|undefined>,commit:(change:(data:LocalData)=>LocalData)=>Promise<void>){
  const memory=useRef<SavedFoodsCache|undefined>(undefined);
  const memoryAccount=useRef(user);
  if(memoryAccount.current!==user){memory.current=undefined;memoryAccount.current=user;}
  return useCallback(async (requireLibrary=false):Promise<Food[]> => {
    const {loadSavedLibrary}=await import('./lib/loadSavedLibrary');
    return loadSavedLibrary(requireLibrary,user,ref,alive,foodsEtag,commit,memory);
  }, [commit, user,ref,alive,foodsEtag]);
}
