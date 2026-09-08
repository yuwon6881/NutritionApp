import {expect,test} from 'vitest';
import {adjustSplit,gramsFromSplit,macroKeys,macroPresetId,macroPresets,splitFromGrams} from './macros';

const total=(split:{protein:number;carbs:number;fat:number})=>macroKeys.reduce((sum,key)=>sum+split[key],0);

test('every preset is a whole-percent split of the calorie target',()=>{
  for(const preset of macroPresets)if(preset.split)expect(total(preset.split)).toBe(100);
});

test('raising one macro lowers the other two and keeps the total at 100',()=>{
  const next=adjustSplit({protein:30,carbs:40,fat:30},'protein',40);
  expect(next.protein).toBe(40);
  expect(next.carbs).toBeLessThan(40);
  expect(next.fat).toBeLessThan(30);
  expect(total(next)).toBe(100);
});

test('lowering one macro raises the other two',()=>{
  const next=adjustSplit({protein:30,carbs:40,fat:30},'carbs',20);
  expect(next.carbs).toBe(20);
  expect(next.protein).toBeGreaterThan(30);
  expect(total(next)).toBe(100);
});

test('a request outside the supported band is held at the boundary',()=>{
  expect(adjustSplit({protein:30,carbs:40,fat:30},'carbs',-15).carbs).toBe(0);
  expect(adjustSplit({protein:30,carbs:40,fat:30},'protein',95).protein).toBe(60);
});

test('the other two macros stop at their own boundaries',()=>{
  const next=adjustSplit({protein:25,carbs:5,fat:70},'fat',80);
  expect(total(next)).toBe(100);
  expect(next.carbs).toBeGreaterThanOrEqual(0);
  expect(next.protein).toBeGreaterThanOrEqual(10);
});

test('grams and shares round-trip through a calorie target',()=>{
  const grams=gramsFromSplit(2000,{protein:30,carbs:40,fat:30});
  expect(grams).toEqual({protein:150,carbs:200,fat:67});
  expect(splitFromGrams(2000,grams)).toEqual({protein:30,carbs:40,fat:30});
});

test('a missing calorie target or nutrient leaves the split unknown',()=>{
  expect(splitFromGrams(null,{protein:150,carbs:200,fat:67})).toBeNull();
  expect(splitFromGrams(2000,{protein:150,carbs:null,fat:67})).toBeNull();
});

test('a split is reported as its preset when it matches one',()=>{
  expect(macroPresetId({protein:25,carbs:5,fat:70})).toBe('keto');
  expect(macroPresetId({protein:31,carbs:39,fat:30})).toBe('custom');
  expect(macroPresetId(null)).toBe('auto');
});
