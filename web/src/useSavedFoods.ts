import {useCallback,type RefObject} from 'react';
import type {Food,LocalData} from './types';
import {apiWithMeta} from './lib/api';
import {readSavedFoods,saveSavedFoods} from './lib/local';
import {isSavedFoodsCacheUsable,mergeSavedFoods} from './lib/savedFoods';
import {project} from './lib/projection';

export function useSavedFoods(user:string,ref:RefObject<LocalData|undefined>,alive:RefObject<boolean>,foodsEtag:RefObject<string|undefined>,commit:(change:(data:LocalData)=>LocalData)=>Promise<void>){
  return useCallback(async (requireLibrary=false):Promise<Food[]> => {
    if (!user) return [];
    const accountId=ref.current?.state.id;
    const currentAccount=()=>alive.current&&!!accountId&&ref.current?.state.id===accountId;
    const updateLibrary=(change:(data:LocalData)=>LocalData)=>commit(current=>current.state.id===accountId?change(current):current);
    const cached = await readSavedFoods(user);
    if(!currentAccount()){
      if(requireLibrary)throw new Error('The account changed while loading saved foods.');
      return [];
    }
    if (cached && ref.current && (!ref.current.state.foods || !ref.current.state.foods.length)) {
      const cacheLoaded=cached.loaded===true||cached.foods.length>0||cached.revision===0;
      await updateLibrary(current => ({ ...current, state: { ...current.state, foods: cached.foods }, foodsLoaded: cacheLoaded }));
    }
    const currentFoodRevision = ref.current?.state.foodRevision ?? ref.current?.state.revision ?? 0;
    const projectedFoods=()=>ref.current?project(ref.current.state,ref.current.queue).foods:[];
    if(!navigator.onLine&&requireLibrary&&!ref.current?.foodsLoaded)
      throw new Error('Connect once to load your saved foods before starring a new food.');
    if (isSavedFoodsCacheUsable(cached,currentFoodRevision)||!navigator.onLine) return projectedFoods();
    try {
      const res = await apiWithMeta<{ foods: Food[]; revision: number; foodRevision?: number }>('/foods', {
        headers: foodsEtag.current ? { 'If-None-Match': foodsEtag.current } : undefined
      });
      if(!currentAccount())throw new Error('The account changed while loading saved foods.');
      if (res.etag) foodsEtag.current = res.etag;
      if (res.notModified) return projectedFoods();
      if (res.data?.foods && alive.current) {
        await saveSavedFoods(user, res.data.foods, res.data.foodRevision ?? res.data.revision);
        await updateLibrary(current => ({ ...current, state: { ...current.state,
          foods: mergeSavedFoods(res.data!.foods,current.state.foods,res.data!.foodRevision ?? res.data!.revision),
          foodRevision: Math.max(current.state.foodRevision??0,res.data!.foodRevision ?? res.data!.revision) }, foodsLoaded:true }));
      }
    } catch (error) {
      if(requireLibrary)throw error;
    }
    if(!currentAccount()){
      if(requireLibrary)throw new Error('The account changed while loading saved foods.');
      return [];
    }
    return projectedFoods();
  }, [commit, user,ref,alive,foodsEtag]);
}
