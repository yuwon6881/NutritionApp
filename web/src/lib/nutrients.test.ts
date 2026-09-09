import {expect,it} from 'vitest';
import {rescaleNutrients} from './nutrients';

const base = {
  name: 'Rice',
  calories: 130,
  protein: 2.7,
  fat: 0.3,
  carbs: 28,
  fiber: null,
  source: 'USDA',
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
