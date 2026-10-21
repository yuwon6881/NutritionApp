import {Modal} from './ui/Modal';
import {Button} from './ui/Button';
import {Checkbox} from './ui/Checkbox';

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
  importWeight?: boolean;
  onImportWeightChange?: (checked: boolean) => void;
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
  importWeight,
  onImportWeightChange,
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
      description="Daily steps are read-only and kept for 31 days. Disconnect any time."
      restoreFocus={restoreFocus}
      width="md"
    >
      <div className="google-health-disclosure">
        <div className="disclosure-item google-health-weight-option">
          <Checkbox
            id="google-health-sync-data"
            role="switch"
            aria-label="Sync health & nutrition data"
            checked={isDataSyncChecked}
            onChange={handleToggle}
          >
            <span>
              <strong>Upload weight, food & body fat</strong>
              <small>Sends new entries to Google Health.</small>
            </span>
          </Checkbox>
        </div>

        {onImportWeightChange && (
          <div className="disclosure-item google-health-weight-option">
            <Checkbox
              id="google-health-import-weight"
              role="switch"
              aria-label="Import weigh-ins from Google Health"
              checked={Boolean(importWeight)}
              onChange={onImportWeightChange}
            >
              <span>
                <strong>Import weigh-ins</strong>
                <small>Fills days with no weigh-in.</small>
              </span>
            </Checkbox>
          </div>
        )}

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
