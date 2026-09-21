import {expect,it} from 'vitest';
import {aiFoodLineKey,basketEntries,basketTotals,lineFromAi,lineFromPer100,lineKey} from './foodBasket';

it('keys by source and trimmed lowercased name', () => {
  expect(lineKey(' Banana ', 'Open Food Facts')).toBe('Open Food Facts|banana');
  expect(lineKey('egg', 'Open Food Facts')).toBe('Open Food Facts|egg');
});

it('keeps recovered AI batch rows idempotent for the same scan identity',()=>{
  expect(aiFoodLineKey('scan-id',0)).toBe('ai:scan-id:0');
  expect(aiFoodLineKey('scan-id',0)).toBe(aiFoodLineKey('scan-id',0));
  expect(aiFoodLineKey('scan-id',1)).not.toBe(aiFoodLineKey('scan-id',0));
});

it('lineFromPer100 defaults quantity to 100 grams', () => {
  const line = lineFromPer100({
    name: 'Oats',
    calories: 389,
    protein: 16.9,
    fat: 6.9,
    carbs: 66.3,
    fiber: 10.6,
    source: 'Open Food Facts',
  });
  expect(line.quantity).toBe(100);
  expect(line.unit).toBe('g');
  expect(line.calories).toBe(389);
  expect(line.key).toBe('Open Food Facts|oats');
});

it('lineFromAi preserves existing quantity and unit without rescaling', () => {
  const line = lineFromAi({
    name: 'Boiled egg',
    quantity: 2,
    unit: 'serving',
    calories: 140,
    protein: 12,
    fat: 10,
    carbs: 1,
    fiber: 0,
    notes: '',
  });
  expect(line.quantity).toBe(2);
  expect(line.unit).toBe('serving');
  expect(line.calories).toBe(140);
});

it('basketTotals computes totals with partial flags and null preservation', () => {
  const line1 = lineFromPer100({name: 'Food A', calories: 200, protein: 10, fat: 5, carbs: 20, fiber: 3, source: 'S'});
  const line2 = lineFromPer100({name: 'Food B', calories: 150, protein: null, fat: 4, carbs: 15, fiber: null, source: 'S'});
  const line3 = lineFromPer100({name: 'Food C', calories: 100, protein: null, fat: 2, carbs: 10, fiber: null, source: 'S'});

  const totals = basketTotals([line1, line2, line3]);
  expect(totals.count).toBe(3);
  expect(totals.calories).toBe(450);

  // Protein: 1 of 3 known -> value=10, partial=true, known=1, total=3
  expect(totals.protein.value).toBe(10);
  expect(totals.protein.partial).toBe(true);
  expect(totals.protein.known).toBe(1);
  expect(totals.protein.total).toBe(3);

  // Fat: all 3 known -> value=11, partial=false, known=3, total=3
  expect(totals.fat.value).toBe(11);
  expect(totals.fat.partial).toBe(false);
  expect(totals.fat.known).toBe(3);

  // Fiber: 1 of 3 known -> value=3, partial=true
  expect(totals.fiber.value).toBe(3);
  expect(totals.fiber.partial).toBe(true);

  // When no food reports a nutrient: value is null, partial is false
  const noProtein = basketTotals([line2, line3]);
  expect(noProtein.protein.value).toBeNull();
  expect(noProtein.protein.partial).toBe(false);
  expect(noProtein.protein.known).toBe(0);
});

it('basketEntries stamps date and time onto each line while omitting key', () => {
  const line = lineFromPer100({name: 'Apple', calories: 52, protein: 0.3, fat: 0.2, carbs: 14, fiber: 2.4, source: 'Open Food Facts'});
  const entries = basketEntries([line], {date: '2026-09-09', time: '12:00'});
  expect(entries).toHaveLength(1);
  expect(entries[0].date).toBe('2026-09-09');
  expect(entries[0].time).toBe('12:00');
  expect(entries[0].name).toBe('Apple');
  expect((entries[0] as any).key).toBeUndefined();
});


it('starts a declared serving with scaled nutrients and preserves unknowns',()=>{
  const line=lineFromPer100({name:'Powder',source:'OFF',calories:400,protein:80,carbs:null,fat:4,fiber:null,portions:[{label:'scoop',grams:30}]});
  expect(line).toMatchObject({quantity:1,unit:'serving',portionLabel:'scoop',portionGrams:30,calories:120,protein:24,carbs:null,fiber:null});
  expect(basketEntries([line],{date:'2026-09-12',time:null})[0]).toMatchObject({portionGrams:30,calories:120,fiber:null});
});
it('restores saved portions and rejects invalid serving weights',()=>{
  const food={name:'Powder',source:'OFF',calories:400,protein:80,carbs:null,fat:4,fiber:null};
  expect(lineFromPer100({...food,portionsJson:'[{"label":"scoop","grams":30}]'}).calories).toBe(120);
  expect(lineFromPer100({...food,portions:[{label:'scoop',grams:0}]})).toMatchObject({quantity:100,unit:'g',calories:400});
});
