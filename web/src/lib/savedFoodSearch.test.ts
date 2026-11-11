import {describe,expect,it} from 'vitest';
import type {Food,FoodSearchResult} from '../types';
import {savedFoodKind,savedFoodsMatching,withSavedFoods} from './savedFoodSearch';

const base:Food={id:'f',name:'Oats',calories:100,protein:null,carbs:null,fat:null,fiber:null,servingGrams:100,favourite:false,source:'manual',ingredientsJson:'[]',portionsJson:'[]',cookedYieldGrams:null,revision:1,deleted:false};
const custom:Food={...base,id:'custom',name:'Homemade Protein Bar'};
const label:Food={...base,id:'label',name:'Protein Milk',source:'AI label estimate',barcode:'12345678'};
const recipe:Food={...base,id:'recipe',name:'Protein Pancakes',source:'Personal recipe',ingredientsJson:'[{"name":"Egg"}]'};
const starred:Food={...base,id:'starred',name:'Protein powder',source:'Open Food Facts',favourite:true};
const foods=[custom,label,recipe,starred];
const row=(name:string,source:string,code?:string):FoodSearchResult=>({name,calories:50,protein:1,fat:1,carbs:1,fiber:null,source,servingGrams:100,basis:'per100g',code});

describe('saved food kind',()=>{
  it('tells a custom food, a recipe and a starred catalogue food apart, whatever their favourite flag',()=>{
    expect(savedFoodKind(custom)).toBe('custom');
    expect(savedFoodKind({...custom,favourite:true})).toBe('custom');
    expect(savedFoodKind(label)).toBe('custom');
    expect(savedFoodKind(recipe)).toBe('recipe');
    expect(savedFoodKind(starred)).toBe('provider');
    expect(savedFoodKind({...base,source:'USDA FoodData Central / Brand'})).toBe('provider');
  });
});

describe('saved foods in food search',()=>{
  it('answers with custom foods and recipes whose name carries every query word',()=>{
    expect(savedFoodsMatching(foods,'protein',true).map(food=>food.id)).toEqual(['custom','label','recipe']);
    expect(savedFoodsMatching(foods,'bar prot',true).map(food=>food.id)).toEqual(['custom']);
    expect(savedFoodsMatching(foods,'protein cake',true)).toEqual([]);
  });

  it('leaves recipes out where a recipe cannot be chosen, and never repeats a starred catalogue food',()=>{
    expect(savedFoodsMatching(foods,'protein',false).map(food=>food.id)).toEqual(['custom','label']);
  });

  it('waits for three characters and skips deleted foods',()=>{
    expect(savedFoodsMatching(foods,'pr',true)).toEqual([]);
    expect(savedFoodsMatching([{...custom,deleted:true}],'protein',true)).toEqual([]);
  });

  it('lists favourites first among the matches',()=>{
    expect(savedFoodsMatching([custom,{...label,favourite:true}],'protein',true).map(food=>food.id)).toEqual(['label','custom']);
  });

  it('puts the matches ahead of catalogue rows and drops a catalogue row for the same food',()=>{
    const results=[row('Protein shake','Open Food Facts'),row('Homemade Protein Bar','manual'),row('Other milk','Open Food Facts','12345678')];
    const merged=withSavedFoods(results,foods,'protein',true);
    expect(merged.map(result=>result.name)).toEqual(['Homemade Protein Bar','Protein Milk','Protein Pancakes','Protein shake']);
    expect(merged.map(result=>result.saved)).toEqual(['custom','custom','recipe',undefined]);
  });

  it('returns the catalogue rows untouched when nothing saved matches',()=>{
    const results=[row('Rice','USDA FoodData Central')];
    expect(withSavedFoods(results,foods,'rice',true)).toEqual(results);
  });
});
