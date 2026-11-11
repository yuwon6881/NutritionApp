import type {Food,FoodSearchResult} from '../types';
import {isFatSecretSource} from './foodSources';
import {barcodeValue,foodToSearchResult,isRecipe} from './logFood';

/**
 * What a saved food is. A recipe is built from ingredients; a provider food is a catalogue result the
 * person starred; everything else is a food they entered themselves (typed, or read from a label).
 * Being a favourite is separate from all three.
 */
export type SavedFoodKind='recipe'|'custom'|'provider';

/** Catalogue sources the API stamps on its results; a saved food carrying one came from a provider. */
const isProviderSource=(source:string)=>/^(USDA FoodData Central|Open Food Facts)/.test(source)||isFatSecretSource(source);

export function savedFoodKind(food:Food):SavedFoodKind{
  if(isRecipe(food))return 'recipe';
  return isProviderSource(food.source)?'provider':'custom';
}

const words=(text:string)=>text.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);

/** A saved food answers a search when its name carries every word of the query, as a word start. */
function namesEveryWord(name:string,queryWords:readonly string[]){
  const nameWords=words(name);
  return queryWords.every(word=>nameWords.some(candidate=>candidate.startsWith(word)));
}

/**
 * The person's own foods that a food search should answer with: custom foods, and recipes where a
 * recipe may be chosen. Starred provider foods are left to the catalogue, which already returns them.
 * Search needs three characters, the same floor as the catalogue request.
 */
export function savedFoodsMatching(foods:readonly Food[],query:string,includeRecipes:boolean):Food[]{
  const trimmed=query.trim();
  if(trimmed.length<3)return [];
  const queryWords=words(trimmed);
  if(!queryWords.length)return [];
  return foods.filter(food=>{
    if(food.deleted)return false;
    const kind=savedFoodKind(food);
    if(kind==='provider'||(kind==='recipe'&&!includeRecipes))return false;
    return namesEveryWord(food.name,queryWords);
  }).sort((a,b)=>Number(b.favourite)-Number(a.favourite)||a.name.localeCompare(b.name));
}

/**
 * Catalogue results with the person's matching foods ahead of them. A catalogue row that is the same
 * food (same barcode, or same name and source, as when it was rebuilt from a diary entry) gives way
 * to the saved one, so nothing is listed twice.
 */
export function withSavedFoods(results:readonly FoodSearchResult[],foods:readonly Food[],query:string,includeRecipes:boolean):FoodSearchResult[]{
  const matches=savedFoodsMatching(foods,query,includeRecipes);
  if(!matches.length)return [...results];
  const sameFood=(row:FoodSearchResult)=>matches.some(food=>{
    const barcode=barcodeValue(food.barcode);
    if(barcode&&barcode===barcodeValue(row.code))return true;
    return food.name.trim().toLowerCase()===row.name.trim().toLowerCase()&&food.source===row.source;
  });
  const own=matches.map(food=>({...foodToSearchResult(food),saved:savedFoodKind(food)==='recipe'?'recipe' as const:'custom' as const}));
  return [...own,...results.filter(row=>!sameFood(row))];
}
