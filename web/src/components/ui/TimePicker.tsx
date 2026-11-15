import {useId, useRef, useState, type KeyboardEvent} from 'react';
import {Clock} from 'lucide-react';
import {FieldFrame} from './Form';
import {TimePopover, format12Display} from './TimePopover';

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
}

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
}: TimePickerProps) {
  const generatedId = useId();
  const timeId = idProp ?? generatedId;
  const timeName = nameProp ?? idProp ?? timeId;
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  const closePopover = () => {
    setIsOpen(false);
    triggerRef.current?.focus({preventScroll: true});
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Tab' && isOpen) {
      setIsOpen(false);
      return;
    }
    if (e.key === 'Escape' && isOpen) {
      e.preventDefault();
      e.stopPropagation();
      closePopover();
    }
  };

  return (
    <FieldFrame
      label={label}
      validate={validate}
      className={`field time-picker-field ${className}`.trim()}
      ref={containerRef}
      onKeyDown={handleKeyDown}
    >
      <label htmlFor={timeId} onClick={e => { e.preventDefault(); triggerRef.current?.focus(); setIsOpen(prev => !prev); }}>{label}</label>
      <div className="custom-time-wrapper">
        <button
          ref={triggerRef}
          id={`${timeId}-trigger`}
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
          autoComplete="off"
          value={value || ''}
          required={required}
          disabled={disabled}
          onChange={e => onChange(e.target.value)}
          className="accessible-native-time"
          tabIndex={-1}
        />

        {isOpen && (
          <TimePopover
            label={label}
            value={value}
            onChange={onChange}
            onClose={() => setIsOpen(false)}
            anchorRef={triggerRef}
            containerRef={containerRef}
          />
        )}
      </div>
      {hint && <small id={`${timeId}-hint`}>{hint}</small>}
    </FieldFrame>
  );
}
