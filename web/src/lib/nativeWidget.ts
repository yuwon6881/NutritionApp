import { registerPlugin } from '@capacitor/core';
import type { AppState } from '../types';
import { today } from './format';
import { planForDate, targetsForDate } from './dailyTargets';
import { isNativeApp } from './nativeApp';
import { displayEnergy, energyLabel, unitsFor } from './units';

interface WidgetSummaryPayload {
  accountId: string;
  date: string;
  caloriesText: string;
  caloriesSubtext: string;
  macrosText: string;
}

interface NutritionWidgetPlugin {
  updateWidgetSummary(payload: WidgetSummaryPayload): Promise<void>;
  clearWidgetSummary(): Promise<void>;
}

const nativeDevice = registerPlugin<NutritionWidgetPlugin>('NutritionDevice');
let lastSyncedSignature = '';

/** Builds a pure text summary of today's energy and macro intake for Android widget display. */
export function buildWidgetSummaryPayload(state: AppState, date = today(state.profile?.timeZone)): WidgetSummaryPayload {
  const units = unitsFor(state.settings);
  const energyUnit = units.energy;
  const unitName = energyLabel(energyUnit);
  const entries = state.entries.filter(entry => !entry.deleted && entry.date === date);
  const calories = entries.reduce((sum, entry) => sum + entry.calories, 0);
  const protein = Math.round(entries.reduce((sum, entry) => sum + (entry.protein ?? 0), 0));
  const carbs = Math.round(entries.reduce((sum, entry) => sum + (entry.carbs ?? 0), 0));
  const fat = Math.round(entries.reduce((sum, entry) => sum + (entry.fat ?? 0), 0));

  const targets = targetsForDate(planForDate(state, date), date);
  const caloriesText = `${displayEnergy(calories, energyUnit)} ${unitName}`;
  let caloriesSubtext = entries.length > 0 ? 'Logged today' : 'Nothing logged yet';
  if (targets.calories != null && targets.calories > 0) {
    const remaining = targets.calories - calories;
    const absText = displayEnergy(Math.abs(remaining), energyUnit);
    const deltaLabel = remaining === 0 ? 'on target' : remaining > 0 ? `${absText} ${unitName} left` : `${absText} ${unitName} over`;
    caloriesSubtext = `of ${displayEnergy(targets.calories, energyUnit)} ${unitName} · ${deltaLabel}`;
  }

  const formatMacro = (prefix: string, grams: number, target?: number | null) =>
    target != null && target > 0 ? `${prefix} ${grams}/${Math.round(target)}g` : `${prefix} ${grams}g`;
  const macrosText = [
    formatMacro('P', protein, targets.protein),
    formatMacro('C', carbs, targets.carbs),
    formatMacro('F', fat, targets.fat),
  ].join(' · ');

  return {
    accountId: state.id,
    date,
    caloriesText,
    caloriesSubtext,
    macrosText,
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
