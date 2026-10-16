import {expect,it} from 'vitest';
import {displayMass,displayPortion,measureOf,parsePortions,resolveGrams,serializePortions,validatePortions} from './portions';

it('rejects invalid recipe serving ratios before serialization and accepts boundary amounts',()=>{
  for(const grams of [2000/0.1,1/10000,NaN,Infinity]){
    expect(()=>serializePortions([{label:'serving',grams}])).toThrow(/0.1–10,000/);
  }
  for(const grams of [0.1,10000,500/4]){
    expect(JSON.parse(serializePortions([{label:'serving',grams}]))).toEqual([{label:'serving',grams}]);
  }
});

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
  expect(displayPortion({quantity:1.5,unit:'serving',portionLabel:'cup',portionGrams:90})).toBe('1.5 cups · 135 g');
  expect(displayPortion({quantity:1,unit:'serving',portionLabel:'1 slice',portionGrams:25})).toBe('1 slice · 25 g');
  expect(displayPortion({quantity:2,unit:'serving',portionLabel:'1 slice',portionGrams:25})).toBe('2 slices · 50 g');
  expect(displayPortion({quantity:1,unit:'serving',portionLabel:'1 scoop',portionGrams:30})).toBe('1 scoop · 30 g');
  expect(displayPortion({quantity:1,unit:'serving',portionLabel:null,portionGrams:null})).toBe('1 serving');
});

it('pluralises a serving or a familiar portion noun and never guesses at other labels',()=>{
  expect(displayPortion({quantity:2,unit:'serving',portionLabel:null,portionGrams:null})).toBe('2 servings');
  expect(displayPortion({quantity:0.5,unit:'serving',portionLabel:null,portionGrams:null})).toBe('0.5 servings');
  expect(displayPortion({quantity:3,unit:'serving',portionLabel:'slice',portionGrams:20})).toBe('3 slices · 60 g');
  expect(displayPortion({quantity:1,unit:'serving',portionLabel:'slice',portionGrams:20})).toBe('1 slice · 20 g');
  expect(displayPortion({quantity:2,unit:'serving',portionLabel:'1 glass',portionGrams:200})).toBe('2 glasses · 400 g');
  expect(displayPortion({quantity:2,unit:'serving',portionLabel:'1 sandwich',portionGrams:150})).toBe('2 sandwiches · 300 g');
  // An unfamiliar label keeps its own spelling rather than receiving a guessed plural.
  expect(displayPortion({quantity:2,unit:'serving',portionLabel:'Big Mac',portionGrams:215})).toBe('2 × Big Mac · 430 g');
  expect(displayPortion({quantity:2,unit:'serving',portionLabel:'1 leaf',portionGrams:5})).toBe('2 leaf · 10 g');
  expect(displayPortion({quantity:1,unit:'serving',portionLabel:'Big Mac',portionGrams:215})).toBe('1 Big Mac · 215 g');
  expect(displayPortion({quantity:2,unit:'serving',portionLabel:'1 slice (30 g)',portionGrams:30})).toBe('2 slice (30 g) · 60 g');
});

it('displays only the mass when one is known, and the serving otherwise',()=>{
  expect(displayMass({quantity:75,unit:'g',portionLabel:null,portionGrams:null})).toBe('75 g');
  expect(displayMass({quantity:1,unit:'serving',portionLabel:'1 tart',portionGrams:52})).toBe('52 g');
  expect(displayMass({quantity:1.5,unit:'serving',portionLabel:'bowl',portionGrams:210})).toBe('315 g');
  expect(displayMass({quantity:1,unit:'serving',portionLabel:null,portionGrams:null})).toBe('1 serving');
});

it('shows liquid amounts in millilitres and legacy records in grams',()=>{
  const ml={measure:'ml' as const,quantity:250,unit:'g' as const,portionLabel:null,portionGrams:null};
  expect(displayPortion(ml)).toBe('250 ml');
  expect(displayMass({...ml,unit:'serving',portionLabel:'glass',portionGrams:200,quantity:1.5})).toBe('300 ml');
  expect(displayPortion({measure:'ml',quantity:2,unit:'serving',portionLabel:'200 ml carton',portionGrams:200})).toBe('400 ml carton · 400 ml');
  expect(displayPortion({quantity:250,unit:'g',portionLabel:null,portionGrams:null})).toBe('250 g');
  expect(measureOf({measure:'ml'})).toBe('ml');
  expect(measureOf({})).toBe('g');
  expect(measureOf(null)).toBe('g');
});
