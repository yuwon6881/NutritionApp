import type {AiEstimate,Entry,Food,FoodSearchResult} from '../types';
import {blankNutrients} from '../types';
import {parsePortions,serializePortions} from './portions';
import type {FoodDraft} from '../components/FoodEditor';

export function isRecipe(food:Food):boolean{
  if(!food.ingredientsJson)return false;
  try{
    const parsed=JSON.parse(food.ingredientsJson);
    return Array.isArray(parsed)&&parsed.length>0;
  }catch{
    return false;
  }
}

/** Only real 8–14 digit product codes count as barcodes. */
export function barcodeValue(code:string|null|undefined):string|null{
  const normalized=code?.trim()??'';
  return /^[0-9]{8,14}$/.test(normalized)?normalized:null;
}

export function foodToSearchResult(food:Food):FoodSearchResult{
  return {
    name:food.name,
    calories:food.calories,
    protein:food.protein,
    fat:food.fat,
    carbs:food.carbs,
    fiber:food.fiber,
    source:food.source,
    servingGrams:food.servingGrams||100,
    portions:parsePortions(food.portionsJson),
    code:barcodeValue(food.barcode),
    basis:'per100g',
  };
}

export function parseAiEstimate(resultJson:string):AiEstimate{
  let estimate:AiEstimate;
  try{estimate=JSON.parse(resultJson) as AiEstimate;}catch{throw new Error('AI returned an invalid estimate. Try again.');}
  if(!Array.isArray(estimate.foods))throw new Error('AI returned an invalid estimate. Try again.');
  return estimate;
}

/**
 * A nutrition-label reading becomes a per-100 g custom food draft when the
 * declared serving weight is known; otherwise it stays per serving. Nothing
 * is invented: unknown nutrients stay null and no serving weight is guessed.
 */
export function labelFoodDraft(food:AiEstimate['foods'][number],barcode:string):Partial<Entry&Food>{
  const declaredGrams=food.unit==='g'
    ?food.quantity
    :(food.portionGrams!=null?food.quantity*food.portionGrams:null);
  const known=declaredGrams!=null&&Number.isFinite(declaredGrams)&&declaredGrams>0;
  const ratio=known?100/declaredGrams:1;
  const hasPortion=known&&food.unit==='serving'&&food.portionLabel&&food.portionGrams!=null;
  return {
    ...blankNutrients,
    name:food.name,
    source:'AI label estimate',
    quantity:known?100:1,
    unit:known?'g':'serving',
    portionLabel:known&&hasPortion?food.portionLabel??null:null,
    portionGrams:known&&hasPortion?food.portionGrams??null:null,
    calories:food.calories*ratio,
    protein:food.protein==null?null:food.protein*ratio,
    carbs:food.carbs==null?null:food.carbs*ratio,
    fat:food.fat==null?null:food.fat*ratio,
    fiber:food.fiber==null?null:food.fiber*ratio,
    portionsJson:hasPortion?serializePortions([{label:food.portionLabel!,grams:food.portionGrams!}]):'[]',
    barcode,
  };
}

/** A barcode food is stored per 100 g; the entered serving must state its weight. */
export function barcodeFoodPer100(data:FoodDraft,barcode:string):FoodDraft{
  if(data.unit==='serving'&&(!data.portionLabel||data.portionGrams==null))
    throw new Error('Enter the serving label and weight in grams before saving this barcode food.');
  const grams=data.unit==='g'
    ?data.quantity
    :(data.portionGrams!=null&&data.quantity>0?data.quantity*data.portionGrams:null);
  if(grams==null||!Number.isFinite(grams)||grams<=0)
    throw new Error('Enter the serving weight in grams before saving this barcode food.');
  const ratio=100/grams;
  const portions=data.unit==='serving'&&data.portionLabel&&data.portionGrams!=null
    ?serializePortions([{label:data.portionLabel,grams:data.portionGrams}])
    :data.portionsJson;
  return {
    ...data,
    calories:data.calories*ratio,
    protein:data.protein==null?null:data.protein*ratio,
    carbs:data.carbs==null?null:data.carbs*ratio,
    fat:data.fat==null?null:data.fat*ratio,
    fiber:data.fiber==null?null:data.fiber*ratio,
    quantity:100,
    unit:'g',
    portionLabel:null,
    portionGrams:null,
    portionsJson:portions,
    barcode,
  };
}
