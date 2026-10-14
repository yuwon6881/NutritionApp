import {expect,it} from 'vitest';
import type {FoodSearchResult} from '../types';
import {nutritionSummary} from './FoodPicker';

const result=(extra:Partial<FoodSearchResult>):FoodSearchResult=>({
  name:'HL Low Fat Milk',calories:51,protein:4.2,fat:1,carbs:6.2,fiber:null,source:'Open Food Facts',servingGrams:100,portions:[],code:'9557305000316',basis:'per100g',...extra,
});

it('states a per-100 basis in the food measure',()=>{
  expect(nutritionSummary(result({}))).toBe('51 kcal / 100 g');
  expect(nutritionSummary(result({measure:'ml'}))).toBe('51 kcal / 100 ml');
});

it('states a declared serving in the food measure without repeating it',()=>{
  const serving=(label:string)=>result({measure:'ml',portions:[{label,grams:200}],servingCalories:102});
  expect(nutritionSummary(serving('serving'))).toBe('102 kcal / serving (200 ml)');
  expect(nutritionSummary(serving('200 ml'))).toBe('102 kcal / 200 ml');
  expect(nutritionSummary(serving('1 carton (200 ml)'))).toBe('102 kcal / 1 carton (200 ml)');
});
