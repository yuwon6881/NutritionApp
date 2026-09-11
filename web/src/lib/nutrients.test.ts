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
