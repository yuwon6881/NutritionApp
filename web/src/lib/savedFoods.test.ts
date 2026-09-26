import {describe,expect,it} from 'vitest';
import {favouriteMutation,findSavedFood,isSavedFoodsCacheUsable,mergeSavedFoods} from './savedFoods';
import type {Food} from '../types';
import {foodToSearchResult} from './logFood';

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

describe('saved food identity and late responses',()=>{
  it('updates mapped nutrition in place and blocks a record needing conflict review',()=>{
    const mapped={...food,barcode:'12345678'};
    const candidate={...foodToSearchResult(mapped),name:'Provider product',source:'provider',calories:999};
    const op=favouriteMutation([mapped],candidate,[]);
    expect(op.recordId).toBe(mapped.id);
    expect((op.data as Food).calories).toBe(100);
    expect((op.data as Food).favourite).toBe(true);
    expect(()=>favouriteMutation([mapped],candidate,[{...op,id:'blocked',error:'Revision conflict'}])).toThrow(/Review the saved edit/);
    const second=favouriteMutation([op.data as Food],candidate,[]);
    expect((second.data as Food).favourite).toBe(false);
  });
  it('matches an existing barcode before a different provider name or source',()=>{
    const saved={...food,barcode:'12345678',name:'My oats'};
    expect(findSavedFood([saved],{name:'Provider oats',source:'provider',code:' 12345678 '})).toBe(saved);
  });
  it('ignores deleted mappings and retains the name/source fallback',()=>{
    expect(findSavedFood([{...food,deleted:true,barcode:'12345678'}],{name:'Oats',source:'custom',code:'12345678'})).toBeUndefined();
    expect(findSavedFood([food],{name:' OATS ',source:'custom',code:null})).toBe(food);
  });
  it('preserves acknowledged favourites and deletions across a delayed library fetch',()=>{
    const favourite={...food,favourite:true,revision:5};
    expect(mergeSavedFoods([food],[favourite],3)).toEqual([favourite]);
    const deleted={...favourite,deleted:true};
    expect(mergeSavedFoods([food],[deleted],3)).toEqual([deleted]);
    expect(mergeSavedFoods([{...food,revision:6}],[favourite],6)[0].favourite).toBe(false);
  });
});
