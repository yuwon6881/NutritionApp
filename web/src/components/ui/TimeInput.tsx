import {
  useId,
  useRef,
  useState,
  type ChangeEvent,
  type KeyboardEvent,
  type ReactNode,
  type InputHTMLAttributes,
} from 'react';
import {Clock} from 'lucide-react';
import {FieldFrame} from './Form';
import {useProfileClock} from './ProfileClock';
import {
  parseTime,
  to24HourString,
  stepSegment,
  applySegmentDigit,
  getAdjacentSegment,
  type TimeSegment,
} from '../../lib/timeSegments';

export interface TimeInputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'onChange'> {
  label: string;
  hint?: string;
  validate?: () => string | undefined;
  action?: ReactNode;
  insideAction?: ReactNode;
  labelAction?: ReactNode;
  leading?: ReactNode;
  onChange?: (event: ChangeEvent<HTMLInputElement>) => void;
}

export function TimeInput({
  label,
  hint,
  className = '',
  validate,
  action,
  insideAction,
  labelAction,
  leading,
  onChange,
  onBlur,
  disabled = false,
  required = false,
  value: valueProp,
  ...props
}: TimeInputProps) {
  const generatedId = useId();
  const id = props.id ?? generatedId;
  const name = props.name ?? props.id ?? id;

  const clock = useProfileClock();
  const rawValue = String(valueProp ?? '');
  const parsed = parseTime(rawValue);

  const [activeSegment, setActiveSegment] = useState<TimeSegment | null>(null);
  const [buffer, setBuffer] = useState('');
  const bufferTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const nativeInputRef = useRef<HTMLInputElement>(null);

  const clearBuffer = () => {
    setBuffer('');
    if (bufferTimerRef.current) {
      clearTimeout(bufferTimerRef.current);
      bufferTimerRef.current = null;
    }
  };

  const setTimedBuffer = (next: string) => {
    setBuffer(next);
    if (bufferTimerRef.current) clearTimeout(bufferTimerRef.current);
    bufferTimerRef.current = setTimeout(() => {
      setBuffer('');
      bufferTimerRef.current = null;
    }, 1200);
  };

  const emitChange = (newVal: string) => {
    if (nativeInputRef.current) {
      nativeInputRef.current.value = newVal;
    }
    if (onChange) {
      const synthetic = {
        target: {value: newVal, name, id},
        currentTarget: {value: newVal, name, id},
      } as ChangeEvent<HTMLInputElement>;
      onChange(synthetic);
    }
  };

  const handleSegmentClick = (segment: TimeSegment, e: React.MouseEvent) => {
    e.stopPropagation();
    if (disabled) return;
    wrapperRef.current?.focus();
    clearBuffer();
    setActiveSegment(segment);
  };

  const handleWrapperFocus = () => {
    if (disabled) return;
    if (!activeSegment) {
      setActiveSegment('hour');
    }
  };

  const handleWrapperBlur = (e: React.FocusEvent<HTMLDivElement>) => {
    if (!wrapperRef.current?.contains(e.relatedTarget as Node)) {
      setActiveSegment(null);
      clearBuffer();
      onBlur?.(e as unknown as React.FocusEvent<HTMLInputElement>);
    }
  };

  const handleClockClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (disabled) return;
    try {
      if (typeof nativeInputRef.current?.showPicker === 'function') {
        nativeInputRef.current.showPicker();
        return;
      }
    } catch {
      // Browser blocked showPicker or unsupported
    }
    if (!rawValue) {
      emitChange(clock.time());
      setActiveSegment('hour');
    } else {
      setActiveSegment(activeSegment ? null : 'hour');
    }
    wrapperRef.current?.focus();
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (disabled) return;

    if (e.key === 'ArrowRight') {
      e.preventDefault();
      clearBuffer();
      setActiveSegment(prev => (prev ? getAdjacentSegment(prev, 'right') : 'minute'));
      return;
    }

    if (e.key === 'ArrowLeft') {
      e.preventDefault();
      clearBuffer();
      setActiveSegment(prev => (prev ? getAdjacentSegment(prev, 'left') : 'hour'));
      return;
    }

    if (e.key === 'Tab') {
      if (!e.shiftKey) {
        if (activeSegment === 'hour') {
          e.preventDefault();
          clearBuffer();
          setActiveSegment('minute');
          return;
        }
        if (activeSegment === 'minute') {
          e.preventDefault();
          clearBuffer();
          setActiveSegment('period');
          return;
        }
        if (activeSegment === 'period') {
          setActiveSegment(null);
          clearBuffer();
          return;
        }
      } else {
        if (activeSegment === 'period') {
          e.preventDefault();
          clearBuffer();
          setActiveSegment('minute');
          return;
        }
        if (activeSegment === 'minute') {
          e.preventDefault();
          clearBuffer();
          setActiveSegment('hour');
          return;
        }
        if (activeSegment === 'hour') {
          setActiveSegment(null);
          clearBuffer();
          return;
        }
      }
    }

    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault();
      clearBuffer();
      if (!activeSegment) return;
      const delta = e.key === 'ArrowUp' ? 1 : -1;
      const nextTime = stepSegment(activeSegment, parsed, delta, clock.time());
      emitChange(nextTime);
      return;
    }

    if (e.key >= '0' && e.key <= '9') {
      e.preventDefault();
      if (activeSegment === 'period') return;
      const d = Number(e.key);
      const res = applySegmentDigit(activeSegment ?? 'hour', d, buffer, parsed, clock.time());
      emitChange(res.nextTime);
      setActiveSegment(res.nextSegment);
      if (res.nextBuffer) {
        setTimedBuffer(res.nextBuffer);
      } else {
        clearBuffer();
      }
      return;
    }

    if (e.key === 'a' || e.key === 'A') {
      e.preventDefault();
      clearBuffer();
      const nowParsed = parseTime(clock.time());
      emitChange(to24HourString(parsed.hour12 ?? nowParsed.hour12 ?? 12, parsed.minute ?? 0, 'AM'));
      if (activeSegment === 'period') setActiveSegment(null);
      return;
    }

    if (e.key === 'p' || e.key === 'P') {
      e.preventDefault();
      clearBuffer();
      const nowParsed = parseTime(clock.time());
      emitChange(to24HourString(parsed.hour12 ?? nowParsed.hour12 ?? 12, parsed.minute ?? 0, 'PM'));
      if (activeSegment === 'period') setActiveSegment(null);
      return;
    }

    if (e.key === 'Backspace' || e.key === 'Delete') {
      e.preventDefault();
      if (buffer) {
        clearBuffer();
        return;
      }
      if (activeSegment === 'period') {
        setActiveSegment('minute');
      } else if (activeSegment === 'minute') {
        if (parsed.minute == null || parsed.minute === 0) {
          setActiveSegment('hour');
        } else {
          emitChange(to24HourString(parsed.hour12, 0, parsed.period));
        }
      } else if (activeSegment === 'hour') {
        emitChange('');
      }
    }
  };

  const hourDisplay = parsed.hour12 != null ? String(parsed.hour12).padStart(2, '0') : '--';
  const minuteDisplay = parsed.minute != null ? String(parsed.minute).padStart(2, '0') : '--';
  const periodDisplay = parsed.period ?? '--';

  const controlEl = (
    <div
      ref={wrapperRef}
      tabIndex={disabled ? -1 : 0}
      className={`time-segmented-wrapper ${activeSegment ? 'focused' : ''} ${disabled ? 'disabled' : ''}`}
      onFocus={handleWrapperFocus}
      onBlur={handleWrapperBlur}
      onKeyDown={handleKeyDown}
    >
      <div className="time-segments">
        <span
          role="spinbutton"
          tabIndex={-1}
          aria-label="Hours"
          aria-valuenow={parsed.hour12 ?? undefined}
          aria-valuetext={parsed.hour12 ? `${parsed.hour12} o'clock` : 'empty'}
          aria-valuemin={1}
          aria-valuemax={12}
          className={`time-segment ${activeSegment === 'hour' ? 'active' : ''}`}
          onClick={e => handleSegmentClick('hour', e)}
        >
          {hourDisplay}
        </span>
        <span className="time-separator" aria-hidden="true">:</span>
        <span
          role="spinbutton"
          tabIndex={-1}
          aria-label="Minutes"
          aria-valuenow={parsed.minute ?? undefined}
          aria-valuetext={parsed.minute != null ? `${parsed.minute} minutes` : 'empty'}
          aria-valuemin={0}
          aria-valuemax={59}
          className={`time-segment ${activeSegment === 'minute' ? 'active' : ''}`}
          onClick={e => handleSegmentClick('minute', e)}
        >
          {minuteDisplay}
        </span>
        <span
          role="spinbutton"
          tabIndex={-1}
          aria-label="AM or PM"
          aria-valuetext={parsed.period ?? 'empty'}
          className={`time-segment period ${activeSegment === 'period' ? 'active' : ''}`}
          onClick={e => handleSegmentClick('period', e)}
        >
          {periodDisplay}
        </span>
      </div>

      <button
        type="button"
        tabIndex={-1}
        disabled={disabled}
        className="time-picker-icon-btn"
        aria-label={`Open time picker for ${label}`}
        onClick={handleClockClick}
      >
        <Clock size={16} aria-hidden="true" />
      </button>

      {/* Accessible native input for form submissions and automation / Playwright fill */}
      <input
        {...props}
        ref={nativeInputRef}
        id={id}
        name={name}
        type="time"
        autoComplete="off"
        value={rawValue}
        required={required}
        disabled={disabled}
        tabIndex={-1}
        aria-describedby={[props['aria-describedby'], hint ? `${id}-hint` : undefined].filter(Boolean).join(' ') || undefined}
        className="accessible-native-time"
        onChange={e => emitChange(e.target.value)}
      />
    </div>
  );

  const fieldInput = insideAction !== undefined || leading != null ? (
    <div className={`field-input-wrapper${leading != null ? ' has-leading' : ''}`}>
      {leading != null && <span className="field-leading" aria-hidden="true">{leading}</span>}
      {controlEl}
      {insideAction != null && <div className="field-inside-action">{insideAction}</div>}
    </div>
  ) : controlEl;

  return (
    <FieldFrame label={label} validate={validate} className={`field time-input-field ${className}`.trim()}>
      {labelAction ? (
        <div className="field-label-row">
          <label htmlFor={id} onClick={e => { e.preventDefault(); wrapperRef.current?.focus(); setActiveSegment('hour'); }}>
            {label}
          </label>
          {labelAction}
        </div>
      ) : (
        <label htmlFor={id} onClick={e => { e.preventDefault(); wrapperRef.current?.focus(); setActiveSegment('hour'); }}>
          {label}
        </label>
      )}
      {action ? <div className="field-input-row">{fieldInput}{action}</div> : fieldInput}
      {hint && <small id={`${id}-hint`}>{hint}</small>}
    </FieldFrame>
  );
}
