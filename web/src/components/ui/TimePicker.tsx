import {useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent} from 'react';
import {useProfileClock} from './ProfileClock';
import {createPortal} from 'react-dom';
import {Clock} from 'lucide-react';
import {FieldFrame} from './Form';
import {useDismissablePopover} from './useDismissablePopover';

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

function parseTimeParts(val: string, now: string): {hour12: number; minute: number; period: 'AM' | 'PM'} {
  if (!val || !val.includes(':')) {
    const [nowHour, nowMinute] = now.split(':').map(Number);
    const h24 = nowHour;
    return {
      hour12: h24 % 12 || 12,
      minute: nowMinute,
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
  const popoverRef = useRef<HTMLDivElement>(null);
  const [popoverPosition, setPopoverPosition] = useState<{left: number; top: number} | null>(null);

  const clock = useProfileClock();
  const {hour12, minute, period} = parseTimeParts(value, clock.time());

  const closePopover = () => {
    setIsOpen(false);
    setPopoverPosition(null);
    triggerRef.current?.focus({preventScroll: true});
  };

  useLayoutEffect(() => {
    if (!isOpen) return;
    const align = () => {
      const popover = popoverRef.current;
      const anchor = triggerRef.current;
      if (!popover || !anchor) return;

      const vv = window.visualViewport;
      const viewportLeft = vv?.pageLeft ?? window.scrollX;
      const viewportTop = vv?.pageTop ?? window.scrollY;
      const viewportWidth = vv?.width ?? window.innerWidth;
      const viewportHeight = vv?.height ?? window.innerHeight;

      // Cap maximum popover height to available visual viewport minus 24px margin
      const maxAvailableHeight = Math.max(120, viewportHeight - 24);
      popover.style.maxHeight = `${maxAvailableHeight}px`;

      const anchorRect = anchor.getBoundingClientRect();
      const host = containerRef.current?.closest('dialog');
      const hostRect = host?.getBoundingClientRect();

      const popoverWidth = popover.offsetWidth;
      const popoverHeight = popover.offsetHeight;

      // Anchor coords in page coordinate space
      const anchorPageLeft = anchorRect.left + window.scrollX;
      const anchorPageTop = anchorRect.top + window.scrollY;
      const anchorPageBottom = anchorRect.bottom + window.scrollY;

      // Horizontal clamp within visual viewport bounds
      const minLeft = viewportLeft + 12;
      const maxLeft = viewportLeft + viewportWidth - popoverWidth - 12;
      const pageLeft = Math.max(minLeft, Math.min(anchorPageLeft, Math.max(minLeft, maxLeft)));

      // Vertical placement: preferred is below anchor, flip to above if below does not fit
      const spaceBelow = (viewportTop + viewportHeight) - (anchorPageBottom + 6);
      const spaceAbove = (anchorPageTop - 6) - viewportTop;

      let preferredTop: number;
      if (spaceBelow >= popoverHeight || spaceBelow >= spaceAbove) {
        preferredTop = anchorPageBottom + 6;
      } else {
        preferredTop = anchorPageTop - 6 - popoverHeight;
      }

      // Clamp vertical position strictly within visual viewport [viewportTop + 12, viewportTop + viewportHeight - popoverHeight - 12]
      const minTop = viewportTop + 12;
      const maxTop = Math.max(minTop, viewportTop + viewportHeight - popoverHeight - 12);
      const pageTop = Math.max(minTop, Math.min(preferredTop, maxTop));

      if (hostRect) {
        const hostPageLeft = hostRect.left + window.scrollX;
        const hostPageTop = hostRect.top + window.scrollY;
        setPopoverPosition({
          left: pageLeft - hostPageLeft,
          top: pageTop - hostPageTop,
        });
      } else {
        setPopoverPosition({
          left: pageLeft,
          top: pageTop,
        });
      }
    };

    setPopoverPosition(null);
    align();

    window.addEventListener('resize', align);
    window.addEventListener('scroll', align, true);
    window.visualViewport?.addEventListener('resize', align);
    window.visualViewport?.addEventListener('scroll', align);

    let resizeObserver: ResizeObserver | null = null;
    if (typeof ResizeObserver !== 'undefined' && popoverRef.current) {
      resizeObserver = new ResizeObserver(() => {
        align();
      });
      resizeObserver.observe(popoverRef.current);
    }

    return () => {
      window.removeEventListener('resize', align);
      window.removeEventListener('scroll', align, true);
      window.visualViewport?.removeEventListener('resize', align);
      window.visualViewport?.removeEventListener('scroll', align);
      resizeObserver?.disconnect();
    };
  }, [isOpen]);

  useDismissablePopover(isOpen, [containerRef, popoverRef], () => {
    setIsOpen(false);
    setPopoverPosition(null);
  });

  useEffect(() => {
    if (!isOpen) return;
    const handleEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        closePopover();
      }
    };
    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [isOpen]);

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Tab' && isOpen) {
      setIsOpen(false);
      setPopoverPosition(null);
      return;
    }
    if (e.key === 'Escape' && isOpen) {
      e.preventDefault();
      e.stopPropagation();
      closePopover();
    }
  };

  const handleSetNow = () => {
    onChange(clock.time());
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
      <label htmlFor={timeId} onClick={e => { e.preventDefault(); triggerRef.current?.focus(); setIsOpen(prev => !prev); }}>{label}</label>
      <div className="custom-time-wrapper">
        <button
          ref={triggerRef}
          id={`${timeId}-trigger`}
          data-modal-autofocus={dataModalAutofocus || undefined}
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

        {isOpen && createPortal(
          <div
            ref={popoverRef}
            className="custom-time-popover"
            role="dialog"
            aria-label={`Choose ${label}`}
            style={{
              left: popoverPosition?.left ?? 0,
              top: popoverPosition?.top ?? 0,
              visibility: popoverPosition ? 'visible' : 'hidden',
            }}
          >
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
                onClick={closePopover}
              >
                Done
              </button>
            </div>
          </div>,
          containerRef.current?.closest('dialog') ?? document.body
        )}
      </div>
      {hint && <small id={`${timeId}-hint`}>{hint}</small>}
    </FieldFrame>
  );
}
