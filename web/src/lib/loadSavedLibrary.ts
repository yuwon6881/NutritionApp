import type {Food,LocalData} from '../types';
import {apiWithMeta} from './api';
import {readSavedFoods} from './local';
import {isSavedFoodsCacheUsable,mergeSavedFoods,type SavedFoodsCache} from './savedFoods';
import {project} from './projection';

type Ref<T>={current:T};

export async function loadSavedLibrary(requireLibrary:boolean,user:string,ref:Ref<LocalData|undefined>,alive:Ref<boolean>,
  foodsEtag:Ref<string|undefined>,commit:(change:(data:LocalData)=>LocalData)=>Promise<void>,memory:Ref<SavedFoodsCache|undefined>):Promise<Food[]> {
  if (!user) return [];
  const accountId=ref.current?.state.id;
  const currentAccount=()=>alive.current&&!!accountId&&ref.current?.state.id===accountId;
  const updateLibrary=(change:(data:LocalData)=>LocalData)=>commit(current=>current.state.id===accountId?change(current):current);
  const cached = memory.current&&memory.current.revision===ref.current?.state.foodRevision?memory.current:await readSavedFoods(user);
  if(!currentAccount()){
    if(requireLibrary)throw new Error('The account changed while loading saved foods.');
    return [];
  }
  memory.current=cached;
  if (cached && ref.current && !ref.current.foodsLoaded && (!ref.current.state.foods || !ref.current.state.foods.length)) {
    const cacheLoaded=cached.loaded===true||cached.foods.length>0||cached.revision===0;
    await updateLibrary(current => ({ ...current, state: { ...current.state, foods: cached.foods }, foodsLoaded: cacheLoaded&&cached.revision===(current.state.foodRevision??current.state.revision) }));
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
    if (res.notModified) {
      if(memory.current)memory.current={...memory.current,fetchedAt:Date.now()};
      return projectedFoods();
    }
    if (res.data?.foods && alive.current) {
      const revision=res.data.foodRevision??res.data.revision;
      if(revision<(ref.current?.state.foodRevision??0))return projectedFoods();
      await updateLibrary(current => revision<(current.state.foodRevision??0)?current:({ ...current, state: { ...current.state,
        foods: mergeSavedFoods(res.data!.foods,current.state.foods,revision),
        foodRevision: revision }, foodsLoaded:true }));
      if(res.etag)foodsEtag.current=res.etag;
      memory.current={foods:res.data.foods,revision:res.data.foodRevision??res.data.revision,fetchedAt:Date.now(),loaded:true};
    }
  } catch (error) {
    if(requireLibrary)throw error;
  }
  if(!currentAccount()){
    if(requireLibrary)throw new Error('The account changed while loading saved foods.');
    return [];
  }
  return projectedFoods();
}
