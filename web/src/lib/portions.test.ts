import {expect,it} from 'vitest';
import {displayPortion,parsePortions,resolveGrams,serializePortions,validatePortions} from './portions';

it('tolerates malformed and hostile portion JSON without exposing invalid values',()=>{
  expect(parsePortions('{')).toEqual([]);
  expect(parsePortions(JSON.stringify([
    {label:'Cup',grams:90},
    {label:'cup',grams:100},
    {label:'x'.repeat(25),grams:10},
    {label:'Valid',grams:0.1},
  ]))).toEqual([{label:'Cup',grams:90},{label:'Valid',grams:0.1}]);
  expect(parsePortions(JSON.stringify(Array.from({length:20},(_,index)=>({label:`p${index}`,grams:10}))))).toHaveLength(12);
});

it('validates by returning a normalized copy and serializes compactly',()=>{
  const list=[{label:' cup ',grams:90}];
  expect(validatePortions(list)).toEqual([{label:'cup',grams:90}]);
  expect(list).toEqual([{label:' cup ',grams:90}]);
  expect(serializePortions(list)).toBe('[{"label":"cup","grams":90}]');
  expect(()=>validatePortions([{label:'Cup',grams:90},{label:'cup',grams:100}])).toThrow(/unique/i);
});

it('resolves all portion basis shapes while keeping unknown grams null',()=>{
  expect(resolveGrams({quantity:200,unit:'g',portionLabel:null,portionGrams:null})).toBe(200);
  expect(resolveGrams({quantity:1.5,unit:'serving',portionLabel:'cup',portionGrams:90})).toBe(135);
  expect(resolveGrams({quantity:1.5,unit:'serving',portionLabel:null,portionGrams:90})).toBeNull();
  expect(resolveGrams({quantity:1,unit:'serving',portionLabel:null,portionGrams:null})).toBeNull();
  expect(resolveGrams({quantity:0,unit:'g',portionLabel:null,portionGrams:null})).toBeNull();
});

it('displays a frozen portion or an honest legacy serving',()=>{
  expect(displayPortion({quantity:200,unit:'g',portionLabel:null,portionGrams:null})).toBe('200 g');
  expect(displayPortion({quantity:1.5,unit:'serving',portionLabel:'cup',portionGrams:90})).toBe('1.5 cup · 135 g');
  expect(displayPortion({quantity:1,unit:'serving',portionLabel:null,portionGrams:null})).toBe('1 serving');
});
