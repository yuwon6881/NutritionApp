import type {Food,FoodSearchResult,Mutation} from '../types';
import {barcodeValue} from './logFood';
import {serializePortions} from './portions';

export function favouriteMutation(foods:Food[],candidate:FoodSearchResult,queue:Mutation[]):Omit<Mutation,'id'|'holdUntil'>{
  const existing=findSavedFood(foods,candidate);
  if(existing){
    if(queue.some(op=>op.kind==='food'&&op.recordId===existing.id&&op.error))
      throw new Error('Review the saved edit for this food before changing its favourite status.');
    return {kind:'food',recordId:existing.id,expectedRevision:existing.revision,delete:false,data:{...existing,favourite:!existing.favourite}};
  }
  return {kind:'food',recordId:crypto.randomUUID(),expectedRevision:0,delete:false,data:{...candidate,
    barcode:barcodeValue(candidate.code),portionsJson:serializePortions(candidate.portions??[]),
    servingGrams:100,favourite:true,ingredientsJson:'[]',cookedYieldGrams:null}};
}

export function findSavedFood(foods:readonly Food[],candidate:Pick<FoodSearchResult,'name'|'source'|'code'>):Food|undefined{
  const active=foods.filter(food=>!food.deleted);
  const barcode=barcodeValue(candidate.code);
  return (barcode?active.find(food=>barcodeValue(food.barcode)===barcode):undefined)
    ??active.find(food=>food.name.trim().toLowerCase()===candidate.name.trim().toLowerCase()&&food.source===candidate.source);
}

/** A response started before an acknowledged write cannot replace that newer record. */
export function mergeSavedFoods(incoming:Food[],current:Food[],responseRevision:number):Food[]{
  const merged=new Map(incoming.map(food=>[food.id,food]));
  for(const food of current){
    if(food.revision>responseRevision)merged.set(food.id,food);
  }
  return [...merged.values()];
}

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
