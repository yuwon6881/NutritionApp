import type {FoodSearchResult} from '../types';

/**
 * The list with a product read folded into the unconfirmed rows that share its code, so a row
 * opened once shows its nutrition on return and needs no second read. Nutrients, servings, and
 * basis come from the product read, while the row keeps the name and place the person already
 * saw. Every other row is returned unchanged.
 */
export function applyConfirmedFood(results:readonly FoodSearchResult[],confirmed:FoodSearchResult):FoodSearchResult[]{
  if(confirmed.basis!=='per100g'||!confirmed.code)return [...results];
  return results.map(result=>{
    if(result.basis!=='unverified'||result.code!==confirmed.code)return result;
    return {
      ...result,
      calories:confirmed.calories,
      protein:confirmed.protein,
      fat:confirmed.fat,
      carbs:confirmed.carbs,
      fiber:confirmed.fiber,
      servingGrams:confirmed.servingGrams,
      portions:confirmed.portions,
      servingCalories:confirmed.servingCalories,
      basis:'per100g',
      measure:confirmed.measure,
    };
  });
}
