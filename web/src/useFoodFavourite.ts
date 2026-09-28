import {useCallback,useRef,type RefObject} from 'react';
import type {Food,FoodSearchResult,LocalData,Mutation} from './types';
import {favouriteMutation} from './lib/savedFoods';

export function useFoodFavourite(ref:RefObject<LocalData|undefined>,loadSavedFoods:(force?:boolean)=>Promise<Food[]>,mutate:(mutation:Omit<Mutation,'id'|'holdUntil'>)=>Promise<unknown>){
  const favouriteWrites=useRef<Promise<unknown>>(Promise.resolve());
  const toggleFoodFavourite=useCallback((candidate:FoodSearchResult)=>{
    const accountId=ref.current?.state.id;
    const operation=favouriteWrites.current.catch(()=>undefined).then(async()=>{
      if(!accountId||ref.current?.state.id!==accountId)throw new Error('Sign in again before changing saved foods.');
      const foods=await loadSavedFoods(true);
      if(ref.current?.state.id!==accountId)throw new Error('The account changed while loading saved foods.');
      await mutate(favouriteMutation(foods,candidate,ref.current?.queue??[]));
    });
    favouriteWrites.current=operation;
    return operation;
  },[loadSavedFoods,mutate]);
  return toggleFoodFavourite;
}
