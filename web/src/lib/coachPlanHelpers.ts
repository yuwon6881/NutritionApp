import type {EnergyUnit,WeightUnit} from '../types';
import {displayEnergy,displayWeight,energyLabel,parseWeight,weightLabel} from './units';

/**
 * The latest weigh-in as a plan's starting weight, in kg, rounded to the one decimal the field
 * shows so the stored value matches what the user sees. Null when there is no usable weigh-in,
 * so an unknown weight is never turned into a default.
 */
export function defaultStartingWeightKg(latestKg: number | null | undefined, unit: WeightUnit): number | null {
  if (latestKg == null || !Number.isFinite(latestKg) || latestKg <= 0) return null;
  const shown = displayWeight(latestKg, unit, 1).replace(/,/g, '');
  const parsedKg = parseWeight(shown, unit);
  return Number.isFinite(parsedKg) && parsedKg > 0 ? parsedKg : null;
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

/** Formats a single line comparing previous plan calories to new proposed calories. */
export function calorieChangeLine(
  previous: number | null | undefined,
  next: number | null | undefined,
  unit: EnergyUnit = 'kcal'
): string {
  if (previous == null || next == null || !Number.isFinite(previous) || !Number.isFinite(next)) {
    return '';
  }
  const prevDisplay = displayEnergy(previous, unit);
  const nextDisplay = displayEnergy(next, unit);
  const label = energyLabel(unit);
  if (prevDisplay === nextDisplay) {
    return `Daily calories unchanged at ${nextDisplay} ${label}`;
  }
  return `Daily calories: ${prevDisplay} -> ${nextDisplay} ${label}`;
}
