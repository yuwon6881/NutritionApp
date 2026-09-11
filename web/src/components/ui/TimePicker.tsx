import {useEffect, useId, useRef, useState, type KeyboardEvent} from 'react';
import {Clock} from 'lucide-react';
import {FieldFrame} from './Form';

export interface TimePickerProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  required?: boolean;
  hint?: string;
  validate?: () => string | undefined;
  id?: string;
  name?: string;
  className?: string;
  dataModalAutofocus?: boolean;
}

function parseTimeParts(val: string): {hour12: number; minute: number; period: 'AM' | 'PM'} {
  if (!val || !val.includes(':')) {
    const now = new Date();
    const h24 = now.getHours();
    return {
      hour12: h24 % 12 || 12,
      minute: now.getMinutes(),
      period: h24 >= 12 ? 'PM' : 'AM',
    };
  }
  const [hStr, mStr] = val.split(':');
  const h24 = Number(hStr) || 0;
  const minute = Number(mStr) || 0;
  return {
    hour12: h24 % 12 || 12,
    minute: Math.min(59, Math.max(0, minute)),
    period: h24 >= 12 ? 'PM' : 'AM',
  };
}

function format24(hour12: number, minute: number, period: 'AM' | 'PM'): string {
  const h24 = period === 'PM' ? (hour12 % 12) + 12 : hour12 % 12;
  return `${String(h24).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

function format12Display(val: string): string {
  if (!val || !val.includes(':')) return 'Select time';
  const [hStr, mStr] = val.split(':');
  const h24 = Number(hStr);
  const m = Number(mStr);
  if (!Number.isFinite(h24) || !Number.isFinite(m)) return 'Select time';
  const h12 = h24 % 12 || 12;
  const period = h24 >= 12 ? 'PM' : 'AM';
  return `${String(h12).padStart(2, '0')}:${String(m).padStart(2, '0')} ${period}`;
}

const HOURS_12 = [12, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
const MINUTES_5 = [0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55];

export function TimePicker({
  label,
  value,
  onChange,
  disabled = false,
  required = false,
  hint,
  validate,
  id: idProp,
  name: nameProp,
  className = '',
  dataModalAutofocus = false,
}: TimePickerProps) {
  const generatedId = useId();
  const timeId = idProp ?? generatedId;
  const timeName = nameProp ?? idProp ?? timeId;
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  const {hour12, minute, period} = parseTimeParts(value);

  // Close on outside click
  useEffect(() => {
    if (!isOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen]);

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Tab' && isOpen) {
      setIsOpen(false);
      return;
    }
    if (e.key === 'Escape' && isOpen) {
      e.preventDefault();
      e.stopPropagation();
      setIsOpen(false);
      triggerRef.current?.focus({preventScroll: true});
    }
  };

  const handleSetNow = () => {
    const now = new Date();
    const h24 = now.getHours();
    const m = now.getMinutes();
    onChange(`${String(h24).padStart(2, '0')}:${String(m).padStart(2, '0')}`);
  };

  const updateHour = (h: number) => {
    onChange(format24(h, minute, period));
  };

  const updateMinute = (m: number) => {
    onChange(format24(hour12, m, period));
  };

  const updatePeriod = (p: 'AM' | 'PM') => {
    onChange(format24(hour12, minute, p));
  };

  return (
    <FieldFrame
      label={label}
      validate={validate}
      className={`field time-picker-field ${className}`.trim()}
      ref={containerRef}
      onKeyDown={handleKeyDown}
    >
      <label htmlFor={timeId}>{label}</label>
      <div className="custom-time-wrapper">
        <button
          ref={triggerRef}
          id={`${timeId}-trigger`}
          data-modal-autofocus={dataModalAutofocus||undefined}
          type="button"
          disabled={disabled}
          className={`custom-time-trigger ${isOpen ? 'open' : ''} ${disabled ? 'disabled' : ''}`}
          aria-haspopup="dialog"
          aria-expanded={isOpen}
          onClick={() => !disabled && setIsOpen(prev => !prev)}
        >
          <span className="custom-time-display">{format12Display(value)}</span>
          <Clock size={16} className="custom-time-clock-icon" aria-hidden="true" />
        </button>

        {/* Native accessible input for form validation, automation & Playwright */}
        <input
          id={timeId}
          type="time"
          name={timeName}
          value={value || ''}
          required={required}
          disabled={disabled}
          onChange={e => onChange(e.target.value)}
          className="accessible-native-time"
          tabIndex={-1}
          aria-hidden="true"
        />

        {isOpen && (
          <div className="custom-time-popover" role="dialog" aria-label={`Choose ${label}`}>
            <div className="custom-time-header">
              <span className="custom-time-current">{format12Display(value)}</span>
              <button
                type="button"
                className="custom-time-now-btn"
                onClick={handleSetNow}
              >
                Now
              </button>
            </div>

            <div className="custom-time-columns">
              {/* Hour column */}
              <div className="custom-time-column" role="listbox" aria-label="Hour">
                <span className="custom-time-col-header">Hour</span>
                <div className="custom-time-col-scroll">
                  {HOURS_12.map(h => {
                    const isSelected = h === hour12;
                    return (
                      <button
                        key={h}
                        type="button"
                        className={`custom-time-option ${isSelected ? 'selected' : ''}`}
                        aria-selected={isSelected}
                        onClick={() => updateHour(h)}
                      >
                        {String(h).padStart(2, '0')}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Minute column */}
              <div className="custom-time-column" role="listbox" aria-label="Minute">
                <span className="custom-time-col-header">Min</span>
                <div className="custom-time-col-scroll">
                  {MINUTES_5.map(m => {
                    const isSelected = Math.abs(m - minute) < 3 || m === minute;
                    return (
                      <button
                        key={m}
                        type="button"
                        className={`custom-time-option ${isSelected ? 'selected' : ''}`}
                        aria-selected={isSelected}
                        onClick={() => updateMinute(m)}
                      >
                        {String(m).padStart(2, '0')}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* AM/PM column */}
              <div className="custom-time-column period-column" role="listbox" aria-label="Period">
                <span className="custom-time-col-header">Period</span>
                <div className="custom-time-col-scroll">
                  {(['AM', 'PM'] as const).map(p => {
                    const isSelected = p === period;
                    return (
                      <button
                        key={p}
                        type="button"
                        className={`custom-time-option ${isSelected ? 'selected' : ''}`}
                        aria-selected={isSelected}
                        onClick={() => updatePeriod(p)}
                      >
                        {p}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>

            <div className="custom-time-footer">
              <button
                type="button"
                className="button primary custom-time-done-btn"
                onClick={() => {
                  setIsOpen(false);
                  triggerRef.current?.focus();
                }}
              >
                Done
              </button>
            </div>
          </div>
        )}
      </div>
      {hint && <small id={`${timeId}-hint`}>{hint}</small>}
    </FieldFrame>
  );
}
