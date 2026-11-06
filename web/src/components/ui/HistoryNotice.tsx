import {CloudOff,X} from 'lucide-react';
import {useEffect,useState} from 'react';
import type {NutritionStore} from '../../useNutritionStore';
import {Button} from './Button';
import {isSyncStatusActive} from './SyncStatus';

export interface HistoryNoticeProps {
  error?: string;
  hasState?: boolean;
  onRetry?: () => void;
  retryLabel?: string;
  customMessage?: string;
  contextKey?: string;
  store?: NutritionStore;
}

export function HistoryNotice({
  error,
  hasState = true,
  onRetry,
  retryLabel = 'Retry history',
  customMessage,
  contextKey,
  store,
}: HistoryNoticeProps) {
  const [dismissedKey, setDismissedKey] = useState<string | null>(null);

  const rawMessage = customMessage
    ? customMessage
    : error
    ? `${hasState ? 'Saved history shown.' : 'This history is not available on this device.'} ${error}`
    : '';

  const activeKey = `${contextKey ?? ''}:${rawMessage}`;

  useEffect(() => {
    if (dismissedKey && dismissedKey !== activeKey) {
      setDismissedKey(null);
    }
  }, [activeKey, dismissedKey]);

  if (!rawMessage || dismissedKey === activeKey) {
    return null;
  }

  const stacked = isSyncStatusActive(store);

  return (
    <div
      className={`history-toast history-notice ${stacked ? 'history-toast-stacked' : ''}`}
      role="status"
      aria-live="polite"
    >
      <span className="history-toast-icon" aria-hidden="true">
        <CloudOff size={16} />
      </span>
      <span className="history-toast-message">{rawMessage}</span>
      <div className="history-toast-actions">
        {onRetry && (
          <Button size="sm" variant="tertiary" onClick={onRetry}>
            {retryLabel}
          </Button>
        )}
        <button
          type="button"
          className="history-toast-dismiss"
          aria-label="Dismiss notice"
          onClick={() => setDismissedKey(activeKey)}
        >
          <X size={15} aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}
