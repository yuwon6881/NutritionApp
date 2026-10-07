import type {FoodSearchResult} from '../types';
import {barcodeValue} from './logFood';

/** The provider whose search rows can arrive before their per-100 g basis is confirmed. */
export const VERIFYING_PROVIDER='off';
const VERIFYING_SOURCE='Open Food Facts';
/** The first rows of a list are the ones a person reads; one bulk read confirms them all. */
export const VERIFY_LIMIT=10;

/**
 * Codes of the leading Open Food Facts rows that came back unconfirmed because the search could
 * not finish its paced confirming read in time. Other providers' rows are never sent: confirming
 * them with Open Food Facts numbers would mix one source's label into another's.
 */
export function verifiableCodes(results:readonly FoodSearchResult[],limit=VERIFY_LIMIT):string[]{
  const codes:string[]=[];
  for(const result of results){
    if(codes.length>=limit)break;
    const code=barcodeValue(result.code);
    if(result.basis==='unverified'&&code&&result.source.startsWith(VERIFYING_SOURCE)&&!codes.includes(code))codes.push(code);
  }
  return codes;
}

/**
 * The list with confirmed products folded in, mirroring the server's own hydration: nutrients,
 * servings, and basis come from the product read, while the row keeps the name and place the
 * person already saw. Rows that were not confirmed are returned unchanged.
 */
export function applyVerifiedFoods(results:readonly FoodSearchResult[],verified:readonly FoodSearchResult[]):FoodSearchResult[]{
  const byCode=new Map(verified.filter(food=>food.basis==='per100g'&&food.code).map(food=>[food.code!,food]));
  if(byCode.size===0)return [...results];
  return results.map(result=>{
    const product=result.basis==='unverified'&&result.code?byCode.get(result.code):undefined;
    if(!product)return result;
    return {
      ...result,
      calories:product.calories,
      protein:product.protein,
      fat:product.fat,
      carbs:product.carbs,
      fiber:product.fiber,
      servingGrams:product.servingGrams,
      portions:product.portions,
      servingCalories:product.servingCalories,
      basis:'per100g',
    };
  });
}
