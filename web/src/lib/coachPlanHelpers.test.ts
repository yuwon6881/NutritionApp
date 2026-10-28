import {describe,expect,it} from 'vitest';
import {allDaysEqual,latestWeightSuggestion,weeklyPaceMass,formatWeeklyPaceEquivalent} from './coachPlanHelpers';

describe('latestWeightSuggestion', () => {
  it('does not suggest when isExistingPlan is false', () => {
    const res = latestWeightSuggestion({
      isExistingPlan: false,
      fieldWeightKg: 82.5,
      trendWeightKg: 82.9,
      unit: 'kg'
    });
    expect(res.visible).toBe(false);
  });

  it('does not suggest when trend weight is missing or non-positive', () => {
    expect(latestWeightSuggestion({isExistingPlan: true, fieldWeightKg: 82.5, trendWeightKg: null, unit: 'kg'}).visible).toBe(false);
    expect(latestWeightSuggestion({isExistingPlan: true, fieldWeightKg: 82.5, trendWeightKg: 0, unit: 'kg'}).visible).toBe(false);
  });

  it('suggests trend weight when difference is at least 0.1 display units', () => {
    const res = latestWeightSuggestion({
      isExistingPlan: true,
      fieldWeightKg: 82.5,
      trendWeightKg: 82.9,
      unit: 'kg'
    });
    expect(res.visible).toBe(true);
    expect(res.label).toBe('Use latest: 82.9 kg');
    expect(res.weightKg).toBe(82.9);
  });

  it('does not suggest when difference is under 0.1 display units', () => {
    const res = latestWeightSuggestion({
      isExistingPlan: true,
      fieldWeightKg: 82.5,
      trendWeightKg: 82.54,
      unit: 'kg'
    });
    expect(res.visible).toBe(false);
  });

  it('formats suggestion in lb when unit is lb', () => {
    // 80 kg is approx 176.4 lb; 85 kg is approx 187.4 lb
    const res = latestWeightSuggestion({
      isExistingPlan: true,
      fieldWeightKg: 80,
      trendWeightKg: 85,
      unit: 'lb'
    });
    expect(res.visible).toBe(true);
    expect(res.label).toBe('Use latest: 187.4 lb');
  });

  it('works with positional arguments', () => {
    const res = latestWeightSuggestion(82.5, 82.9, 'kg', true);
    expect(res.visible).toBe(true);
    expect(res.label).toBe('Use latest: 82.9 kg');
    expect(res.weightKg).toBe(82.9);
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
