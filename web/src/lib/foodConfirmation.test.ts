import {describe,expect,it} from 'vitest';
import type {FoodSearchResult} from '../types';
import {applyConfirmedFood} from './foodConfirmation';

const row=(name:string,code:string|null,basis:'per100g'|'unverified',source='USDA FoodData Central'):FoodSearchResult=>({
  name,calories:90,protein:null,fat:null,carbs:null,fiber:null,source:code?`${source} / ${code}`:source,servingGrams:100,portions:[],code,basis,
});

describe('food confirmation',()=>{
  it('fills confirmed nutrition in place and leaves everything else as it was',()=>{
    const results=[row('Goodday milk','9556404123223','unverified'),row('Unknown','1111111111111','unverified'),row('Rice','2222222222222','per100g')];
    const confirmed:FoodSearchResult={...row('GOODDAY CULTURED MILK','9556404123223','per100g'),calories:64,protein:1.2,portions:[{label:'1 bottle',grams:125}],servingCalories:80};
    const next=applyConfirmedFood(results,confirmed);
    expect(next[0]).toMatchObject({name:'Goodday milk',calories:64,protein:1.2,basis:'per100g',servingCalories:80,portions:[{label:'1 bottle',grams:125}]});
    expect(next[1]).toBe(results[1]);
    expect(next[2]).toBe(results[2]);
  });

  it('ignores a product the server could not confirm',()=>{
    const results=[row('Milk','9556404123223','unverified')];
    expect(applyConfirmedFood(results,row('Milk','9556404123223','unverified'))[0]).toBe(results[0]);
  });

  it('takes the confirmed measure from the product read',()=>{
    const unverified=row('Milk','9556404123223','unverified');
    const confirmed={...row('Milk','9556404123223','per100g'),measure:'ml' as const};
    expect(applyConfirmedFood([unverified],confirmed)[0].measure).toBe('ml');
  });
});
