import {Modal} from './ui/Modal';
import {Button} from './ui/Button';
import {Checkbox} from './ui/Checkbox';
import {ShieldCheck, ArrowUpRight} from 'lucide-react';

interface GoogleHealthDisclosureProps {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  syncWeight: boolean;
  onSyncWeightChange: (checked: boolean) => void;
  syncNutrition: boolean;
  onSyncNutritionChange: (checked: boolean) => void;
  syncBodyFat: boolean;
  onSyncBodyFatChange: (checked: boolean) => void;
  loading?: boolean;
  error?: string;
  restoreFocus?: HTMLElement | null;
}

export function GoogleHealthDisclosure({
  open,
  onClose,
  onConfirm,
  syncWeight,
  onSyncWeightChange,
  syncNutrition,
  onSyncNutritionChange,
  syncBodyFat,
  onSyncBodyFatChange,
  loading = false,
  error,
  restoreFocus,
}: GoogleHealthDisclosureProps) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Connect Google Health"
      description="Review how NutritionApp accesses and handles your activity and health data."
      restoreFocus={restoreFocus}
      width="md"
    >
      <div className="google-health-disclosure">
        <div className="disclosure-points" role="list">
          <div className="disclosure-item" role="listitem">
            <strong>Read-only step counts</strong>
            <p>NutritionApp reads your daily step totals. Steps never affect calories, expenditure, or coaching targets.</p>
          </div>
          <div className="disclosure-item" role="listitem">
            <strong>Rolling 31-day copy</strong>
            <p>Only today plus the preceding 30 calendar days of steps are retained. Older step history is automatically purged.</p>
          </div>
          <div className="disclosure-item" role="listitem">
            <strong>Persistent across sign-outs</strong>
            <p>Your connection remains linked to your NutritionApp account if you sign out.</p>
          </div>
          <div className="disclosure-item" role="listitem">
            <strong>Complete deletion upon disconnect</strong>
            <p>Disconnecting revokes access and deletes imported step data and pending upload mappings. Google copies already uploaded remain in Google Health.</p>
          </div>
        </div>

        <div className="disclosure-item google-health-weight-option">
          <Checkbox id="google-health-sync-weight" role="switch" aria-label="Sync weight to Google Health" checked={syncWeight} onChange={onSyncWeightChange}>
            <span><strong>Sync scale weight</strong><small>Uploads recorded scale weight entries to Google Health.</small></span>
          </Checkbox>
        </div>

        <div className="disclosure-item google-health-weight-option">
          <Checkbox id="google-health-sync-nutrition" role="switch" checked={syncNutrition} onChange={onSyncNutritionChange}>
            <span><strong>Sync calories & macronutrients</strong><small>Uploads diary food logs (calories, protein, carbs, fat, fiber) to Google Health nutrition logs.</small></span>
          </Checkbox>
        </div>

        <div className="disclosure-item google-health-weight-option">
          <Checkbox id="google-health-sync-body-fat" role="switch" checked={syncBodyFat} onChange={onSyncBodyFatChange}>
            <span><strong>Sync body fat percentage</strong><small>Uploads body fat percentage measurements to Google Health body fat metrics.</small></span>
          </Checkbox>
        </div>

        <div className="disclosure-data-notice">
          <ShieldCheck size={18} aria-hidden="true" className="policy-icon" />
          <p>
            NutritionApp follows the{' '}
            <a href="https://developers.google.com/terms/api-services-user-data-policy" target="_blank" rel="noopener noreferrer">
              Google API Services User Data Policy <ArrowUpRight size={13} aria-hidden="true" />
            </a>
            , including Limited Use requirements. Background uploads continue while the app is closed; incomplete or unknown uploads stay visible for recovery.
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
