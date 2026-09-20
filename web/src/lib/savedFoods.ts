import type {Food} from '../types';

export const savedFoodsCacheMaxAgeMs=300_000;

export type SavedFoodsCache={
  foods:Food[];
  revision:number;
  fetchedAt:number;
  /** Added after bootstrap-only snapshots could look authoritative. */
  loaded?:boolean;
};

export function isSavedFoodsCacheUsable(cache:SavedFoodsCache|undefined,currentFoodRevision:number,now=Date.now()):boolean{
  if(!cache)return false;
  const age=now-cache.fetchedAt;
  if(age<0||age>savedFoodsCacheMaxAgeMs||cache.revision!==currentFoodRevision)return false;
  // Older clients could persist an empty bootstrap placeholder at a non-zero
  // food revision. Force one server read before trusting that legacy record.
  if(cache.loaded!==true&&cache.foods.length===0&&currentFoodRevision>0)return false;
  return true;
}
