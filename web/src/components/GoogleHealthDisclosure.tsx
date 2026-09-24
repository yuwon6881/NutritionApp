import {Modal} from './ui/Modal';
import {Button} from './ui/Button';
import {Checkbox} from './ui/Checkbox';
import {ShieldCheck, ArrowUpRight} from 'lucide-react';

interface GoogleHealthDisclosureProps {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  syncData?: boolean;
  onSyncDataChange?: (checked: boolean) => void;
  syncWeight?: boolean;
  onSyncWeightChange?: (checked: boolean) => void;
  syncNutrition?: boolean;
  onSyncNutritionChange?: (checked: boolean) => void;
  syncBodyFat?: boolean;
  onSyncBodyFatChange?: (checked: boolean) => void;
  loading?: boolean;
  error?: string;
  restoreFocus?: HTMLElement | null;
}

export function GoogleHealthDisclosure({
  open,
  onClose,
  onConfirm,
  syncData,
  onSyncDataChange,
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
  const isDataSyncChecked = syncData !== undefined
    ? syncData
    : Boolean(syncWeight || syncNutrition || syncBodyFat);

  const handleToggle = (checked: boolean) => {
    onSyncDataChange?.(checked);
    onSyncWeightChange?.(checked);
    onSyncNutritionChange?.(checked);
    onSyncBodyFatChange?.(checked);
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Connect Google Health"
      description="Review how NutritionApp accesses your activity and health data."
      restoreFocus={restoreFocus}
      width="md"
    >
      <div className="google-health-disclosure">
        <div className="disclosure-points" role="list">
          <div className="disclosure-item" role="listitem">
            <strong>Daily steps</strong>
            <p>Read-only step totals are retained for 31 days.</p>
          </div>
          <div className="disclosure-item" role="listitem">
            <strong>Data control</strong>
            <p>Disconnecting revokes access and deletes local sync data; Google copies remain.</p>
          </div>
        </div>

        <div className="disclosure-item google-health-weight-option">
          <Checkbox
            id="google-health-sync-data"
            role="switch"
            aria-label="Sync health & nutrition data"
            checked={isDataSyncChecked}
            onChange={handleToggle}
          >
            <span>
              <strong>Sync weight, nutrition & body fat</strong>
              <small>Uploads scale entries, diary meals, and body fat entries.</small>
            </span>
          </Checkbox>
        </div>

        <div className="disclosure-data-notice">
          <ShieldCheck size={18} aria-hidden="true" className="policy-icon" />
          <p>
            Complies with the{' '}
            <a href="https://developers.google.com/terms/api-services-user-data-policy" target="_blank" rel="noopener noreferrer">
              Google API Services User Data Policy <ArrowUpRight size={13} aria-hidden="true" />
            </a>
            , including Limited Use requirements.
          </p>
        </div>

        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}

        <div className="modal-actions">
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
