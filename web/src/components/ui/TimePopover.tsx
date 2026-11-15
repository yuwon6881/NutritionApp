import {useEffect, useLayoutEffect, useRef, useState, type RefObject} from 'react';
import {createPortal} from 'react-dom';
import {useProfileClock} from './ProfileClock';
import {useDismissablePopover} from './useDismissablePopover';
import {useViewportAlign} from './useViewportAlign';

type Period = 'AM' | 'PM';

const HOURS_12 = [12, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
const MINUTES_5 = [0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55];

function parseTimeParts(val: string, now: string): {hour12: number; minute: number; period: Period} {
  const source = val && val.includes(':') ? val : now;
  const [hStr, mStr] = source.split(':');
  const h24 = Number(hStr) || 0;
  const minute = Number(mStr) || 0;
  return {
    hour12: h24 % 12 || 12,
    minute: Math.min(59, Math.max(0, minute)),
    period: h24 >= 12 ? 'PM' : 'AM',
  };
}

function format24(hour12: number, minute: number, period: Period): string {
  const h24 = period === 'PM' ? (hour12 % 12) + 12 : hour12 % 12;
  return `${String(h24).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

export function format12Display(val: string): string {
  if (!val || !val.includes(':')) return 'Select time';
  const [hStr, mStr] = val.split(':');
  const h24 = Number(hStr);
  const m = Number(mStr);
  if (!Number.isFinite(h24) || !Number.isFinite(m)) return 'Select time';
  return `${String(h24 % 12 || 12).padStart(2, '0')}:${String(m).padStart(2, '0')} ${h24 >= 12 ? 'PM' : 'AM'}`;
}

export interface TimePopoverProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  /** Called after Done, Escape or an outside press; the owner restores focus. */
  onClose: () => void;
  /** The control the popover hangs from; placement flips above it when there is no room below. */
  anchorRef: RefObject<HTMLElement | null>;
  /** The whole field; presses inside it do not count as outside presses. */
  containerRef: RefObject<HTMLElement | null>;
}

/** The shared themed hour/minute/period chooser behind every time field. */
export function TimePopover({label, value, onChange, onClose, anchorRef, containerRef}: TimePopoverProps) {
  const popoverRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<{left: number; top: number} | null>(null);
  const clock = useProfileClock();
  const {hour12, minute, period} = parseTimeParts(value, clock.time());

  const align = () => {
    const popover = popoverRef.current;
    const anchor = anchorRef.current;
    if (!popover || !anchor) return;

    const vv = window.visualViewport;
    const viewportLeft = vv?.pageLeft ?? window.scrollX;
    const viewportTop = vv?.pageTop ?? window.scrollY;
    const viewportWidth = vv?.width ?? window.innerWidth;
    const viewportHeight = vv?.height ?? window.innerHeight;

    popover.style.maxHeight = `${Math.max(120, viewportHeight - 24)}px`;

    const anchorRect = anchor.getBoundingClientRect();
    const hostRect = containerRef.current?.closest('dialog')?.getBoundingClientRect();
    const popoverWidth = popover.offsetWidth;
    const popoverHeight = popover.offsetHeight;

    const anchorPageLeft = anchorRect.left + window.scrollX;
    const anchorPageTop = anchorRect.top + window.scrollY;
    const anchorPageBottom = anchorRect.bottom + window.scrollY;

    const minLeft = viewportLeft + 12;
    const maxLeft = viewportLeft + viewportWidth - popoverWidth - 12;
    const pageLeft = Math.max(minLeft, Math.min(anchorPageLeft, Math.max(minLeft, maxLeft)));

    const spaceBelow = viewportTop + viewportHeight - (anchorPageBottom + 6);
    const spaceAbove = anchorPageTop - 6 - viewportTop;
    const preferredTop = spaceBelow >= popoverHeight || spaceBelow >= spaceAbove
      ? anchorPageBottom + 6
      : anchorPageTop - 6 - popoverHeight;

    const minTop = viewportTop + 12;
    const maxTop = Math.max(minTop, viewportTop + viewportHeight - popoverHeight - 12);
    const pageTop = Math.max(minTop, Math.min(preferredTop, maxTop));

    if (hostRect) {
      setPosition({left: pageLeft - (hostRect.left + window.scrollX), top: pageTop - (hostRect.top + window.scrollY)});
    } else {
      setPosition({left: pageLeft, top: pageTop});
    }
  };

  // A fresh opening starts unplaced (hidden) until the first measurement.
  useLayoutEffect(() => { setPosition(null); }, []);
  useViewportAlign(true, align, popoverRef);
  useDismissablePopover(true, [containerRef, popoverRef], onClose);

  useEffect(() => {
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
      }
    };
    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [onClose]);

  const column = (title: string, aria: string, extra: string, options: {key: string | number; text: string; selected: boolean; pick: () => void}[]) => (
    <div className={`custom-time-column${extra}`} role="listbox" aria-label={aria}>
      <span className="custom-time-col-header">{title}</span>
      <div className="custom-time-col-scroll">
        {options.map(option => (
          <button
            key={option.key}
            type="button"
            className={`custom-time-option ${option.selected ? 'selected' : ''}`}
            aria-selected={option.selected}
            onClick={option.pick}
          >
            {option.text}
          </button>
        ))}
      </div>
    </div>
  );

  return createPortal(
    <div
      ref={popoverRef}
      className="custom-time-popover"
      role="dialog"
      aria-label={`Choose ${label}`}
      style={{left: position?.left ?? 0, top: position?.top ?? 0, visibility: position ? 'visible' : 'hidden'}}
    >
      <div className="custom-time-header">
        <span className="custom-time-current">{format12Display(value)}</span>
        <button type="button" className="custom-time-now-btn" onClick={() => onChange(clock.time())}>Now</button>
      </div>
      <div className="custom-time-columns">
        {column('Hour', 'Hour', '', HOURS_12.map(h => ({
          key: h, text: String(h).padStart(2, '0'), selected: h === hour12, pick: () => onChange(format24(h, minute, period)),
        })))}
        {column('Min', 'Minute', '', MINUTES_5.map(m => ({
          key: m, text: String(m).padStart(2, '0'), selected: Math.abs(m - minute) < 3, pick: () => onChange(format24(hour12, m, period)),
        })))}
        {column('Period', 'Period', ' period-column', (['AM', 'PM'] as const).map(p => ({
          key: p, text: p, selected: p === period, pick: () => onChange(format24(hour12, minute, p)),
        })))}
      </div>
      <div className="custom-time-footer">
        <button type="button" className="button primary custom-time-done-btn" onClick={onClose}>Done</button>
      </div>
    </div>,
    containerRef.current?.closest('dialog') ?? document.body,
  );
}
