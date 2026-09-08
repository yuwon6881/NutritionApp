import {useEffect, type ReactNode} from 'react';
import {X, ChevronRight} from 'lucide-react';
import {Button} from './Button';

export interface ActionSheetOption {
  id: string;
  label: string;
  description?: string;
  icon: ReactNode;
  onClick: () => void;
  variant?: 'primary' | 'secondary';
}

export interface ActionSheetProps {
  isOpen: boolean;
  onClose: () => void;
  title?: string;
  subtitle?: string;
  options: ActionSheetOption[];
}

export function ActionSheet({
  isOpen,
  onClose,
  title = 'What would you like to add?',
  subtitle = 'Choose an entry type to update your diary',
  options,
}: ActionSheetProps) {
  // Close on Escape key
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div className="action-sheet-overlay" onClick={onClose} role="dialog" aria-modal="true" aria-label={title}>
      <div
        className="action-sheet-panel"
        onClick={e => e.stopPropagation()}
      >
        <div className="action-sheet-handle-bar" aria-hidden="true" />

        <div className="action-sheet-header">
          <div>
            <h2 className="action-sheet-title">{title}</h2>
            {subtitle && <p className="action-sheet-subtitle">{subtitle}</p>}
          </div>
          <button
            type="button"
            className="action-sheet-close-btn"
            onClick={onClose}
            aria-label="Close add menu"
          >
            <X size={18} />
          </button>
        </div>

        <div className="action-sheet-options">
          {options.map(option => (
            <button
              key={option.id}
              type="button"
              className={`action-sheet-item ${option.variant || ''}`}
              onClick={() => {
                onClose();
                option.onClick();
              }}
              aria-label={option.label}
            >
              <div className="action-sheet-item-icon">{option.icon}</div>
              <div className="action-sheet-item-text">
                <strong>{option.label}</strong>
                {option.description && <small>{option.description}</small>}
              </div>
              <ChevronRight size={18} className="action-sheet-item-chevron" />
            </button>
          ))}
        </div>

        <div className="action-sheet-footer">
          <Button variant="secondary" fullWidth onClick={onClose}>
            Cancel
          </Button>
        </div>
      </div>
    </div>
  );
}
