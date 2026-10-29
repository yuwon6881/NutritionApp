import {describe,expect,it} from 'vitest';
import {allDaysEqual,calorieChangeLine,defaultStartingWeightKg,weeklyPaceMass,formatWeeklyPaceEquivalent} from './coachPlanHelpers';
import {displayWeight} from './units';

describe('defaultStartingWeightKg', () => {
  it('rounds the latest weigh-in to the one decimal the field shows', () => {
    expect(defaultStartingWeightKg(66.24, 'kg')).toBe(66.2);
    expect(defaultStartingWeightKg(82.96, 'kg')).toBe(83);
  });

  it('keeps the value that the pound display would show', () => {
    const kg = defaultStartingWeightKg(85, 'lb');
    expect(kg).not.toBeNull();
    expect(displayWeight(kg as number, 'lb', 1)).toBe(displayWeight(85, 'lb', 1));
  });

  it('is absent when there is no usable weigh-in', () => {
    expect(defaultStartingWeightKg(null, 'kg')).toBeNull();
    expect(defaultStartingWeightKg(undefined, 'kg')).toBeNull();
    expect(defaultStartingWeightKg(0, 'kg')).toBeNull();
    expect(defaultStartingWeightKg(Number.NaN, 'kg')).toBeNull();
  });
});

describe('allDaysEqual', () => {
  it('returns true when all 7 daily calories are equal', () => {
    expect(allDaysEqual([2200, 2200, 2200, 2200, 2200, 2200, 2200])).toBe(true);
  });

  it('returns false when daily calories differ', () => {
    expect(allDaysEqual([2000, 2000, 2000, 2000, 2000, 2500, 2500])).toBe(false);
    expect(allDaysEqual([2200, 2200, 2200, 2200, 2200, 2200, 2201])).toBe(false);
  });

  it('returns false for an empty array', () => {
    expect(allDaysEqual([])).toBe(false);
  });

  it('returns true for a single-element array', () => {
    expect(allDaysEqual([2200])).toBe(true);
  });
});

describe('weeklyPaceMass', () => {
  it('calculates mass in kg correctly', () => {
    // 0.6% of 80 kg = 0.48 kg
    expect(weeklyPaceMass(0.6, 80)).toBeCloseTo(0.48);
  });

  it('handles negative percent', () => {
    // -0.5% of 80 kg = 0.4 kg
    expect(weeklyPaceMass(-0.5, 80)).toBeCloseTo(0.4);
  });

  it('returns null when weight is missing or invalid', () => {
    expect(weeklyPaceMass(0.6, null)).toBe(null);
    expect(weeklyPaceMass(0.6, undefined)).toBe(null);
    expect(weeklyPaceMass(0.6, 0)).toBe(null);
    expect(weeklyPaceMass(0.6, -10)).toBe(null);
  });

  it('returns null when percent is missing', () => {
    expect(weeklyPaceMass(null, 80)).toBe(null);
    expect(weeklyPaceMass(undefined, 80)).toBe(null);
  });
});

describe('formatWeeklyPaceEquivalent', () => {
  it('formats pace in kg with one decimal', () => {
    // 0.6% of 80 kg = 0.48 kg -> rounded to 0.5 kg
    expect(formatWeeklyPaceEquivalent(0.6, 80, 'kg')).toBe(' (≈0.5 kg/wk)');
  });

  it('formats pace in lb with one decimal', () => {
    // 0.6% of 80 kg = 0.48 kg -> in lb: 0.48 * 2.20462 = 1.058 lb -> 1.1 lb
    expect(formatWeeklyPaceEquivalent(0.6, 80, 'lb')).toBe(' (≈1.1 lb/wk)');
  });

  it('returns empty string when weight is missing', () => {
    expect(formatWeeklyPaceEquivalent(0.6, null, 'kg')).toBe('');
    expect(formatWeeklyPaceEquivalent(0.6, 0, 'kg')).toBe('');
  });
});

describe('calorieChangeLine', () => {
  it('formats change line when both are known and differ', () => {
    expect(calorieChangeLine(2200, 2050, 'kcal')).toBe('Daily calories: 2,200 -> 2,050 kcal');
  });

  it('formats unchanged line when both are equal', () => {
    expect(calorieChangeLine(2200, 2200, 'kcal')).toBe('Daily calories unchanged at 2,200 kcal');
  });

  it('returns empty string when previous is unknown', () => {
    expect(calorieChangeLine(null, 2050, 'kcal')).toBe('');
    expect(calorieChangeLine(undefined, 2050, 'kcal')).toBe('');
    expect(calorieChangeLine(NaN, 2050, 'kcal')).toBe('');
  });

  it('returns empty string when next is unknown', () => {
    expect(calorieChangeLine(2200, null, 'kcal')).toBe('');
    expect(calorieChangeLine(2200, undefined, 'kcal')).toBe('');
    expect(calorieChangeLine(2200, NaN, 'kcal')).toBe('');
  });

  it('formats correctly with kJ unit', () => {
    // 2200 kcal is 9205 kJ, 2050 kcal is 8577 kJ
    expect(calorieChangeLine(2200, 2050, 'kj')).toBe('Daily calories: 9,205 -> 8,577 kJ');
    expect(calorieChangeLine(2200, 2200, 'kj')).toBe('Daily calories unchanged at 9,205 kJ');
  });
});
