import {Modal} from './ui/Modal';
import {Button} from './ui/Button';
import {ShieldCheck, ArrowUpRight} from 'lucide-react';

interface GoogleHealthDisclosureProps {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  loading?: boolean;
  error?: string;
  restoreFocus?: HTMLElement | null;
}

export function GoogleHealthDisclosure({
  open,
  onClose,
  onConfirm,
  loading = false,
  error,
  restoreFocus,
}: GoogleHealthDisclosureProps) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Connect Google Health"
      description="Review how NutritionApp accesses and handles your activity data."
      restoreFocus={restoreFocus}
      width="md"
    >
      <div className="google-health-disclosure">
        <div className="disclosure-points" role="list">
          <div className="disclosure-item" role="listitem">
            <strong>Read-only access</strong>
            <p>NutritionApp reads your daily step totals. It never writes, alters, or uploads data to Google Health.</p>
          </div>
          <div className="disclosure-item" role="listitem">
            <strong>Rolling 31-day copy</strong>
            <p>Only today plus the preceding 30 calendar days are retained. Older step history is automatically purged.</p>
          </div>
          <div className="disclosure-item" role="listitem">
            <strong>Independent of coaching</strong>
            <p>Step counts are displayed for your personal reference only. They are never used in calorie equations, expenditure estimates, or coaching recommendations.</p>
          </div>
          <div className="disclosure-item" role="listitem">
            <strong>Persistent across sign-outs</strong>
            <p>Your connection remains linked to your NutritionApp account if you sign out or change your password.</p>
          </div>
          <div className="disclosure-item" role="listitem">
            <strong>Complete deletion upon disconnect</strong>
            <p>Disconnecting in Settings immediately purges all imported step counts and revokes authentication tokens.</p>
          </div>
        </div>

        <div className="disclosure-policy-notice">
          <ShieldCheck size={18} aria-hidden="true" className="policy-icon" />
          <p>
            NutritionApp adheres to the Google API Services User Data Policy, including the Limited Use requirements. Read our{' '}
            <a href="/privacy" target="_blank" rel="noopener noreferrer">
              Privacy Policy <ArrowUpRight size={13} aria-hidden="true" />
            </a>
            ,{' '}
            <a href="/terms" target="_blank" rel="noopener noreferrer">
              Terms <ArrowUpRight size={13} aria-hidden="true" />
            </a>
            , and{' '}
            <a href="/help/google-health" target="_blank" rel="noopener noreferrer">
              Google Health help <ArrowUpRight size={13} aria-hidden="true" />
            </a>
            .
          </p>
        </div>

        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}

        <div className="actions">
          <Button variant="tertiary" onClick={onClose} disabled={loading}>
            Cancel
          </Button>
          <Button variant="primary" onClick={onConfirm} disabled={loading}>
            {loading ? 'Connecting…' : 'Continue to Google'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
