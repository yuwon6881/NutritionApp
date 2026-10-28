import type {WeightUnit} from '../types';
import {displayWeight,parseWeight,weightLabel} from './units';

export interface LatestWeightSuggestion {
  visible: boolean;
  weightKg: number;
  label: string;
}

export interface LatestWeightSuggestionOptions {
  fieldWeightKg?: number | null;
  trendWeightKg?: number | null;
  unit: WeightUnit;
  isExistingPlan?: boolean;
}

/**
 * Recommends the latest trend weight for an existing plan's starting weight
 * when it differs by at least 0.1 in the user's display units.
 */
export function latestWeightSuggestion(
  optionsOrField: LatestWeightSuggestionOptions | number | null | undefined,
  trendWeightKg?: number | null,
  unit?: WeightUnit,
  isExistingPlan?: boolean
): LatestWeightSuggestion {
  let fieldKg: number | null | undefined;
  let trendKg: number | null | undefined;
  let activeUnit: WeightUnit = 'kg';
  let existing = false;

  if (typeof optionsOrField === 'object' && optionsOrField !== null) {
    fieldKg = optionsOrField.fieldWeightKg;
    trendKg = optionsOrField.trendWeightKg;
    activeUnit = optionsOrField.unit;
    existing = Boolean(optionsOrField.isExistingPlan);
  } else {
    fieldKg = optionsOrField;
    trendKg = trendWeightKg;
    activeUnit = unit ?? 'kg';
    existing = Boolean(isExistingPlan);
  }

  if (!existing || trendKg == null || !Number.isFinite(trendKg) || trendKg <= 0) {
    return {visible: false, weightKg: 0, label: ''};
  }

  const displayVal = displayWeight(trendKg, activeUnit, 1);
  const trendDisplayNum = Number(displayVal.replace(/,/g, ''));
  const fieldVal = fieldKg != null && Number.isFinite(fieldKg) && fieldKg > 0 ? displayWeight(fieldKg, activeUnit, 1) : null;
  const fieldDisplayNum = fieldVal != null ? Number(fieldVal.replace(/,/g, '')) : null;

  // Differ by at least 0.1 in display units.
  const diff = fieldDisplayNum != null ? Math.abs(trendDisplayNum - fieldDisplayNum) : Infinity;
  const visible = diff >= 0.099;

  // The kg value corresponding to the displayed 1-decimal amount, matching field input parsing.
  const parsedKg = parseWeight(displayVal.replace(/,/g, ''), activeUnit);
  const targetWeightKg = Number.isFinite(parsedKg) ? parsedKg : trendKg;
  const label = `Use latest: ${displayVal} ${weightLabel(activeUnit)}`;

  return {
    visible,
    weightKg: targetWeightKg,
    label
  };
}

/** True when all daily calorie targets in the list are identical. */
export function allDaysEqual(values: number[]): boolean {
  if (values.length === 0) return false;
  const first = values[0];
  return values.every(v => v === first);
}

/** Computes weekly pace mass in kg = percent / 100 * weightKg. */
export function weeklyPaceMass(
  percent: number | null | undefined,
  weightKg: number | null | undefined
): number | null {
  if (
    percent == null ||
    weightKg == null ||
    !Number.isFinite(percent) ||
    !Number.isFinite(weightKg) ||
    weightKg <= 0
  ) {
    return null;
  }
  return (Math.abs(percent) / 100) * weightKg;
}

/** Formats the mass equivalent in user's units, e.g. ' (≈0.5 kg/wk)'. */
export function formatWeeklyPaceEquivalent(
  percent: number | null | undefined,
  weightKg: number | null | undefined,
  unit: WeightUnit
): string {
  const massKg = weeklyPaceMass(percent, weightKg);
  if (massKg == null || massKg <= 0) return '';
  return ` (≈${displayWeight(massKg, unit, 1)} ${weightLabel(unit)}/wk)`;
}
