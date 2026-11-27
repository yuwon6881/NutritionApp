import { Button } from '../ui/Button';
import type { AiActionBatch, AiActionType, AiUiAction } from '../../lib/api/ai';
import { readableDate } from '../../lib/format';
import { displayEnergy, displayWeight, energyLabel, weightLabel } from '../../lib/units';
import type { EnergyUnit, WeightUnit } from '../../types';

const actionLabels: Record<AiActionType, string> = {
  openFoodLog: 'View food diary',
  openAddFoodDraft: 'Review food search',
  openQuickAddDraft: 'Review quick add',
  openAiFoodDescription: 'Review meal description',
  openWeightEntry: 'Review weight entry',
  openCoaching: 'View coaching',
  openExpenditure: 'View energy progress',
  openBarcodeScanner: 'Open barcode scanner',
};

interface Props {
  batch: AiActionBatch;
  disabled: boolean;
  onResolve: (decision: 'accepted' | 'dismissed') => void;
  units?: { energy: EnergyUnit; weight: WeightUnit };
}

function formatActionDetail(action: AiUiAction, units?: { energy: EnergyUnit; weight: WeightUnit }): string {
  const payload = action.payload;
  const parts: string[] = [];
  if (typeof payload.label === 'string') parts.push(payload.label);
  if (typeof payload.query === 'string') parts.push(payload.query);
  if (typeof payload.description === 'string') parts.push(payload.description);
  if (typeof payload.calories === 'number') {
    const energyUnit = units?.energy ?? 'kcal';
    parts.push(`${displayEnergy(payload.calories, energyUnit)} ${energyLabel(energyUnit)}`);
  }
  const macros = (['protein', 'carbs', 'fat'] as const)
    .map(key => typeof payload[key] === 'number' ? `${Math.round((payload[key] as number) * 10) / 10} g ${key}` : null)
    .filter((item): item is string => item !== null);
  if (macros.length) parts.push(macros.join(', '));
  if (typeof payload.kg === 'number') {
    const weightUnit = units?.weight ?? 'kg';
    parts.push(`${displayWeight(payload.kg, weightUnit, 1)} ${weightLabel(weightUnit)}`);
  }
  if (typeof payload.date === 'string') parts.push(readableDate(payload.date));
  if (typeof payload.time === 'string') parts.push(payload.time);
  return parts.join(' · ');
}

export function AiActionReview({ batch, disabled, onResolve, units }: Props) {
  return <section className="ai-chat-review" aria-label="Suggested screen">
    <span className="ai-chat-review-tag">Suggested screen</span>
    <p className="ai-chat-review-title">{batch.actions.map(action => actionLabels[action.type]).join(', ')}</p>
    {batch.actions.map((action, index) => {
      const detail = formatActionDetail(action, units);
      return detail ? <p className="ai-chat-action-detail" key={index}>{detail}</p> : null;
    })}
    <small>Opens the existing screen. Changes still need your confirmation there.</small>
    <div className="ai-chat-actions">
      <Button variant="tertiary" disabled={disabled} onClick={() => onResolve('dismissed')}>Dismiss</Button>
      <Button variant="primary" disabled={disabled} onClick={() => onResolve('accepted')}>Open</Button>
    </div>
  </section>;
}
