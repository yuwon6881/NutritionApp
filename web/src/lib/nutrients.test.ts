import {expect,it} from 'vitest';
import {rescaleNutrients} from './nutrients';

const base = {
  name: 'Rice',
  calories: 130,
  protein: 2.7,
  fat: 0.3,
  carbs: 28,
  fiber: null,
  source: 'Open Food Facts',
  quantity: 100,
  unit: 'g' as const,
};

it('rescales calories and known macros proportionally while preserving nulls', () => {
  const scaled = rescaleNutrients(base, 200);
  expect(scaled.quantity).toBe(200);
  expect(scaled.calories).toBe(260);
  expect(scaled.protein).toBeCloseTo(5.4);
  expect(scaled.fat).toBeCloseTo(0.6);
  expect(scaled.carbs).toBe(56);
  expect(scaled.fiber).toBeNull();
});

it('guards against invalid, zero, or negative quantities without changing nutrients', () => {
  const zero = rescaleNutrients(base, 0);
  expect(zero.quantity).toBe(0);
  expect(zero.calories).toBe(130);
  expect(zero.protein).toBe(2.7);

  const neg = rescaleNutrients(base, -50);
  expect(neg.quantity).toBe(-50);
  expect(neg.calories).toBe(130);

  const nan = rescaleNutrients(base, NaN);
  expect(nan.calories).toBe(130);
});

it('guards when current quantity is zero or negative', () => {
  const invalidCurrent = {...base, quantity: 0};
  const scaled = rescaleNutrients(invalidCurrent, 150);
  expect(scaled.quantity).toBe(150);
  expect(scaled.calories).toBe(130);
});

it('correctly rescales from 100g to 1 named portion with quantity reset', () => {
  // Switching from 100g to a 30g portion with quantity=1 should scale by 30/100
  const switched = rescaleNutrients(base, {quantity: 1, unit: 'serving', portionLabel: 'Slice', portionGrams: 30});
  expect(switched.quantity).toBe(1);
  expect(switched.unit).toBe('serving');
  expect(switched.calories).toBeCloseTo(39); // 130 * 30/100
  expect(switched.protein).toBeCloseTo(0.81); // 2.7 * 30/100
});

it('does not rescale when switching to weight-unknown serving', () => {
  // Switching to serving with no gram weight and quantity=1
  const switched = rescaleNutrients(base, {quantity: 1, unit: 'serving', portionLabel: null, portionGrams: null});
  // beforeGrams=100, afterGrams=null; canUseQuantityRatio=true because quantity changes from 100 to 1
  // BUT onlyQuantity is false (unit also changes), so canUseQuantityRatio=false
  // Falls through to applyBasis: nutrients unchanged
  expect(switched.quantity).toBe(1);
  expect(switched.calories).toBe(130);
});

it('calculates recipe batch nutrients, per-serving targets, and cooked yield density from food ingredients', () => {
  const ingredients = [
    {
      food: {name: 'Rolled Oats', calories: 380, protein: 13, fat: 7, carbs: 68, fiber: 10, source: 'USDA'},
      grams: 100, // 380 kcal, 13g P, 7g F, 68g C
    },
    {
      food: {name: 'Whole Milk', calories: 60, protein: 3.2, fat: 3.2, carbs: 4.8, fiber: 0, source: 'USDA'},
      grams: 200, // 120 kcal, 6.4g P, 6.4g F, 9.6g C
    },
    {
      food: {name: 'Whey Protein', calories: 400, protein: 80, fat: 3, carbs: 4, fiber: null, source: 'Open Food Facts'},
      grams: 30, // 120 kcal, 24g P, 0.9g F, 1.2g C
    }
  ];

  const yieldGrams = 400;
  const servings = 2;

  const totalNutrient = (key: 'calories'|'protein'|'fat'|'carbs'|'fiber') => {
    if (ingredients.some(item => item.food[key] == null)) return null;
    return ingredients.reduce((sum, item) => sum + item.food[key]! * item.grams / 100, 0);
  };

  const totalCalories = totalNutrient('calories');
  const totalProtein = totalNutrient('protein');
  const totalFiber = totalNutrient('fiber');

  // 380 + 120 + 120 = 620 kcal total
  expect(totalCalories).toBe(620);
  // 13 + 6.4 + 24 = 43.4g protein
  expect(totalProtein).toBeCloseTo(43.4);
  // Whey fiber is null, so total fiber should preserve unknown as null
  expect(totalFiber).toBeNull();

  // Per serving (2 servings)
  expect(totalCalories! / servings).toBe(310);
  expect(totalProtein! / servings).toBeCloseTo(21.7);

  // Per 100 g cooked yield (400 g yield)
  // 620 / 400 * 100 = 155 kcal / 100 g
  const per100Calories = (totalCalories! / yieldGrams) * 100;
  expect(per100Calories).toBe(155);
});

