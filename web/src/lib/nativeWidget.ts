import { registerPlugin } from '@capacitor/core';
import type { AppState } from '../types';
import { today } from './format';
import { planForDate, targetsForDate } from './dailyTargets';
import { isNativeApp } from './nativeApp';
import { displayEnergy, energyLabel, unitsFor } from './units';
import { dayIntake } from './weekNutrition';

interface WidgetSummaryPayload {
  accountId: string;
  date: string;
  caloriesText: string;
  caloriesSubtext: string;
  macrosText: string;
  /** The profile's zone, so the widget decides "today" the way the diary does. */
  timeZone: string;
}

interface NutritionWidgetPlugin {
  updateWidgetSummary(payload: WidgetSummaryPayload): Promise<void>;
  clearWidgetSummary(): Promise<void>;
}

const nativeDevice = registerPlugin<NutritionWidgetPlugin>('NutritionDevice');
let lastSyncedSignature = '';

/** Builds a pure text summary of today's energy and macro intake for Android widget display. */
export function buildWidgetSummaryPayload(state: AppState, date = today(state.profile?.timeZone)): WidgetSummaryPayload {
  const timeZone = state.profile?.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  const units = unitsFor(state.settings);
  const energyUnit = units.energy;
  const unitName = energyLabel(energyUnit);
  const entries = state.entries.filter(entry => !entry.deleted && entry.date === date);
  const calories = entries.reduce((sum, entry) => sum + entry.calories, 0);
  // Same rules as the diary: nothing logged is a known zero, a macro no food reports stays
  // unknown (—), and a total that leaves out foods with no value reads "at least" (≥).
  const { intake, partial } = dayIntake(entries, state.days.find(day => day.date === date));
  const macroValue = (key: 'protein' | 'carbs' | 'fat') =>
    entries.length === 0 ? 0 : intake[key] == null ? null : Math.round(intake[key]!);

  const targets = targetsForDate(planForDate(state, date), date);
  const caloriesText = `${displayEnergy(calories, energyUnit)} ${unitName}`;
  let caloriesSubtext = entries.length > 0 ? 'Logged today' : 'Nothing logged yet';
  if (targets.calories != null && targets.calories > 0) {
    const remaining = targets.calories - calories;
    const absText = displayEnergy(Math.abs(remaining), energyUnit);
    const deltaLabel = remaining === 0 ? 'on target' : remaining > 0 ? `${absText} ${unitName} left` : `${absText} ${unitName} over`;
    caloriesSubtext = `of ${displayEnergy(targets.calories, energyUnit)} ${unitName} · ${deltaLabel}`;
  }

  const formatMacro = (prefix: string, key: 'protein' | 'carbs' | 'fat', target?: number | null) => {
    const grams = macroValue(key);
    const shown = grams == null ? '—' : `${partial[key] ? '≥' : ''}${grams}`;
    return target != null && target > 0 ? `${prefix} ${shown}/${Math.round(target)}g` : `${prefix} ${shown}${grams == null ? '' : 'g'}`;
  };
  const macrosText = [
    formatMacro('P', 'protein', targets.protein),
    formatMacro('C', 'carbs', targets.carbs),
    formatMacro('F', 'fat', targets.fat),
  ].join(' · ');

  return {
    accountId: state.id,
    date,
    caloriesText,
    caloriesSubtext,
    macrosText,
    timeZone,
  };
}

export async function syncNativeWidgetSummary(state: AppState): Promise<void> {
  if (!isNativeApp()) return;
  const payload = buildWidgetSummaryPayload(state);
  const signature = JSON.stringify(payload);
  if (signature === lastSyncedSignature) return;
  await nativeDevice.updateWidgetSummary(payload);
  lastSyncedSignature = signature;
}

export async function clearNativeWidgetSummary(): Promise<void> {
  lastSyncedSignature = '';
  if (!isNativeApp()) return;
  await nativeDevice.clearWidgetSummary().catch(() => undefined);
}
