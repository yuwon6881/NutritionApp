import { Button } from '../ui/Button';
import type { AiActionBatch, AiActionType } from '../../lib/api/ai';

const actionLabels: Record<AiActionType, string> = {
  openFoodLog: 'View food diary',
  openAddFoodDraft: 'Review food search',
  openWeightEntry: 'Review weight entry',
  openCoaching: 'View coaching',
  openExpenditure: 'View energy progress',
  openBarcodeScanner: 'Open barcode scanner',
};

interface Props {
  batch: AiActionBatch;
  disabled: boolean;
  onResolve: (decision: 'accepted' | 'dismissed') => void;
}

export function AiActionReview({ batch, disabled, onResolve }: Props) {
  return <section className="ai-chat-review" aria-label="Suggested screen">
    <span className="ai-chat-review-tag">Suggested screen</span>
    <p className="ai-chat-review-title">{batch.actions.map(action => actionLabels[action.type]).join(', ')}</p>
    {batch.actions.map((action, index) => {
      const detail = [action.payload.query, action.payload.date, action.payload.time]
        .filter(value => typeof value === 'string').join(' · ');
      return detail ? <p className="ai-chat-action-detail" key={index}>{detail}</p> : null;
    })}
    <small>Opens the existing screen. Changes still need your confirmation there.</small>
    <div className="ai-chat-actions">
      <Button variant="tertiary" disabled={disabled} onClick={() => onResolve('dismissed')}>Dismiss</Button>
      <Button variant="primary" disabled={disabled} onClick={() => onResolve('accepted')}>Open</Button>
    </div>
  </section>;
}
