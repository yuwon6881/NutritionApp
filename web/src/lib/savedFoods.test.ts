import {describe,expect,it} from 'vitest';
import {isSavedFoodsCacheUsable} from './savedFoods';

const food={id:'food',name:'Oats',calories:100,protein:null,carbs:null,fat:null,fiber:null,servingGrams:100,favourite:false,source:'custom',ingredientsJson:'[]',portionsJson:'[]',cookedYieldGrams:null,revision:1,deleted:false};

describe('saved food cache freshness',()=>{
  it('does not trust a bootstrap placeholder at a non-zero food revision',()=>{
    expect(isSavedFoodsCacheUsable({foods:[],revision:3,fetchedAt:1_000},3,1_001)).toBe(false);
  });

  it('accepts an explicitly loaded empty library',()=>{
    expect(isSavedFoodsCacheUsable({foods:[],revision:3,fetchedAt:1_000,loaded:true},3,1_001)).toBe(true);
  });

  it('accepts a current non-empty cache and rejects stale revisions',()=>{
    const cache={foods:[food],revision:3,fetchedAt:1_000};
    expect(isSavedFoodsCacheUsable(cache,3,1_001)).toBe(true);
    expect(isSavedFoodsCacheUsable(cache,4,1_001)).toBe(false);
  });
});
