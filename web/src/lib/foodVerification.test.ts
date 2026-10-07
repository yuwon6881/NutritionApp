import {describe,expect,it} from 'vitest';
import type {FoodSearchResult} from '../types';
import {applyVerifiedFoods,verifiableCodes} from './foodVerification';

const row=(name:string,code:string|null,basis:'per100g'|'unverified',source='Open Food Facts / ODbL'):FoodSearchResult=>({
  name,calories:90,protein:null,fat:null,carbs:null,fiber:null,source:code?`${source} / ${code}`:source,servingGrams:100,portions:[],code,basis,
});

describe('food verification',()=>{
  it('asks only for the leading unconfirmed Open Food Facts rows with real barcodes',()=>{
    const results=[
      row('Milk','9556404123223','unverified'),
      row('Rice','1234567890123','per100g'),
      row('Bread','9556404123223','unverified'),
      row('USDA cereal','0001234567890','unverified','USDA FoodData Central'),
      row('Odd code','12ab','unverified'),
      ...Array.from({length:12},(_,index)=>row(`Snack ${index}`,String(10_000_000_000+index),'unverified')),
    ];
    const codes=verifiableCodes(results);
    expect(codes[0]).toBe('9556404123223');
    expect(codes).toHaveLength(10);
    expect(codes).not.toContain('1234567890123');
    expect(codes).not.toContain('0001234567890');
  });

  it('fills confirmed nutrition in place and leaves everything else as it was',()=>{
    const results=[row('Goodday milk','9556404123223','unverified'),row('Unknown','1111111111111','unverified'),row('Rice','2222222222222','per100g')];
    const confirmed:FoodSearchResult={...row('GOODDAY CULTURED MILK','9556404123223','per100g'),calories:64,protein:1.2,portions:[{label:'1 bottle',grams:125}],servingCalories:80};
    const next=applyVerifiedFoods(results,[confirmed]);
    expect(next[0]).toMatchObject({name:'Goodday milk',calories:64,protein:1.2,basis:'per100g',servingCalories:80,portions:[{label:'1 bottle',grams:125}]});
    expect(next[1]).toBe(results[1]);
    expect(next[2]).toBe(results[2]);
  });

  it('ignores a product the server could not confirm',()=>{
    const results=[row('Milk','9556404123223','unverified')];
    expect(applyVerifiedFoods(results,[row('Milk','9556404123223','unverified')])[0]).toBe(results[0]);
  });
});
