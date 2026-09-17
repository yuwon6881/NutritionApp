import {AlertTriangle, CheckCircle2, Info} from 'lucide-react';
import {Button} from './Button';

export type CardFeedbackTone = 'error' | 'warning' | 'success' | 'info';

export function CardFeedback({
  tone = 'error',
  title,
  message,
  action,
}: {
  tone?: CardFeedbackTone;
  title?: string;
  message: string;
  action?: {label: string; onClick: () => void; disabled?: boolean};
}) {
  const Icon = tone === 'success' ? CheckCircle2 : tone === 'info' ? Info : AlertTriangle;
  return (
    <div className={`card-feedback ${tone}`} role={tone === 'success' || tone === 'info' ? 'status' : 'alert'}>
      <Icon size={17} aria-hidden="true" />
      <div className="card-feedback-content">
        {title && <strong>{title}</strong>}
        <p>{message}</p>
        {action && (
          <Button type="button" size="sm" variant={tone === 'error' ? 'secondary' : 'tertiary'} onClick={action.onClick} disabled={action.disabled}>
            {action.label}
          </Button>
        )}
      </div>
    </div>
  );
}
