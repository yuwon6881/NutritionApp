import {FieldFrame} from './Form';
import {useEffect, useId, useLayoutEffect, useRef, useState} from 'react';
import {createPortal} from 'react-dom';
import {Calendar, Check, ChevronDown, ChevronLeft, ChevronRight} from 'lucide-react';
import {useDismissablePopover} from './useDismissablePopover';

interface CalendarDropdownProps {
  label: string;
  value: number;
  options: {value: number; label: string}[];
  onChange: (value: number) => void;
  isOpen: boolean;
  onToggle: () => void;
  onClose: () => void;
  id?: string;
  name?: string;
  className?: string;
  selectClassName?: string;
  menuClassName?: string;
}

function CalendarDropdown({
  label,
  value,
  options,
  onChange,
  isOpen,
  onToggle,
  onClose,
  id: idProp,
  name: nameProp,
  className = '',
  selectClassName = '',
  menuClassName = '',
}: CalendarDropdownProps) {
  const generatedId = useId();
  const id = idProp ?? generatedId;
  const name = nameProp ?? id;
  const containerRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [focusedIndex, setFocusedIndex] = useState(-1);

  const selectedIndex = options.findIndex(o => o.value === value);
  const selectedOption = options[selectedIndex];

  useEffect(() => {
    if (isOpen) {
      setFocusedIndex(selectedIndex >= 0 ? selectedIndex : 0);
      requestAnimationFrame(() => {
        if (listRef.current) {
          const selectedEl = listRef.current.querySelector('[aria-selected="true"]') as HTMLElement | null;
          selectedEl?.scrollIntoView({block: 'center'});
        }
      });
    }
  }, [isOpen, selectedIndex]);

  useDismissablePopover(isOpen, [containerRef], onClose);

  useEffect(() => {
    if (isOpen && focusedIndex >= 0 && listRef.current) {
      const el = listRef.current.children[focusedIndex] as HTMLElement | undefined;
      el?.scrollIntoView({block: 'nearest'});
    }
  }, [isOpen, focusedIndex]);

  const handleSelect = (val: number) => {
    onChange(val);
    onClose();
    triggerRef.current?.focus({preventScroll: true});
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!isOpen) {
      if (e.key === 'ArrowDown' || e.key === 'Down' || e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        e.stopPropagation();
        onToggle();
      }
      return;
    }

    if (e.key === 'ArrowDown' || e.key === 'Down') {
      e.preventDefault();
      e.stopPropagation();
      setFocusedIndex(prev => Math.min(options.length - 1, prev + 1));
    } else if (e.key === 'ArrowUp' || e.key === 'Up') {
      e.preventDefault();
      e.stopPropagation();
      setFocusedIndex(prev => Math.max(0, prev - 1));
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      e.stopPropagation();
      if (focusedIndex >= 0 && focusedIndex < options.length) {
        handleSelect(options[focusedIndex].value);
      }
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      onClose();
      triggerRef.current?.focus({preventScroll: true});
    } else if (e.key === 'Tab') {
      onClose();
    }
  };

  return (
    <div className={`calendar-dropdown-wrapper ${className}`.trim()} ref={containerRef}>
      <button
        ref={triggerRef}
        type="button"
        className={`calendar-dropdown-trigger ${isOpen ? 'open' : ''}`}
        aria-label={label}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        onClick={onToggle}
        onKeyDown={handleKeyDown}
      >
        <span className="calendar-dropdown-text">{selectedOption?.label ?? value}</span>
        <ChevronDown size={14} className={`calendar-dropdown-chevron ${isOpen ? 'rotated' : ''}`} />
      </button>

      <select
        id={id}
        name={name}
        className={`accessible-native-select ${selectClassName}`.trim()}
        aria-label={label}
        value={value}
        onChange={e => onChange(Number(e.target.value))}
        tabIndex={-1}
        aria-hidden="true"
      >
        {options.map(opt => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>

      {isOpen && (
        <ul
          ref={listRef}
          className={`calendar-dropdown-menu ${menuClassName}`.trim()}
          role="listbox"
          aria-label={label}
          tabIndex={-1}
          onKeyDown={handleKeyDown}
        >
          {options.map((opt, idx) => {
            const isSelected = opt.value === value;
            const isFocused = idx === focusedIndex;
            return (
              <li
                key={opt.value}
                role="option"
                aria-selected={isSelected}
                className={`calendar-dropdown-option ${isSelected ? 'selected' : ''} ${isFocused ? 'focused' : ''}`}
                onClick={() => handleSelect(opt.value)}
                onMouseEnter={() => setFocusedIndex(idx)}
              >
                <span className="calendar-dropdown-label">{opt.label}</span>
                {isSelected && <Check size={13} className="calendar-dropdown-check" />}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

export interface DatePickerProps {
  label: string;
  value: string; // ISO yyyy-mm-dd
  onChange: (value: string) => void;
  min?: string;
  max?: string;
  required?: boolean;
  disabled?: boolean;
  hint?: string;
  validate?:()=>string|undefined;
  id?: string;
  name?: string;
  className?: string;
}

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

const WEEKDAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

function parseIso(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number);
  if (!y || !m || !d) return new Date();
  return new Date(y, m - 1, d);
}

function toIso(d: Date): string {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function formatDisplay(iso: string): string {
  if (!iso) return 'Select date';
  const parts = iso.split('-');
  if (parts.length === 3) {
    const [yyyy, mm, dd] = parts;
    return `${dd}/${mm}/${yyyy}`;
  }
  return iso;
}

export function DatePicker({
  label,
  value,
  onChange,
  min,
  max,
  required = false,
  disabled = false,
  hint,
  validate,
  id: idProp,
  name: nameProp,
  className = '',
}: DatePickerProps) {
  const generatedId = useId();
  const id = idProp ?? generatedId;
  const name = nameProp ?? idProp ?? id;
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const [activeDropdown, setActiveDropdown] = useState<'month' | 'year' | null>(null);
  const [popoverPosition, setPopoverPosition] = useState<{left:number;top:number}|null>(null);
  const closeCalendar = () => {setIsOpen(false);setActiveDropdown(null);setPopoverPosition(null);triggerRef.current?.focus({preventScroll:true});};

  useLayoutEffect(() => {
    if (!isOpen) return;
    const align = () => {
      const popover=popoverRef.current;
      const anchor=triggerRef.current;
      if(!popover||!anchor)return;
      const anchorRect=anchor.getBoundingClientRect();
      const host=containerRef.current?.closest('dialog');
      const hostRect=host?.getBoundingClientRect();
      const viewportWidth=window.visualViewport?.width??window.innerWidth;
      const viewportHeight=window.visualViewport?.height??window.innerHeight;
      const popoverWidth=popover.offsetWidth;
      const popoverHeight=popover.offsetHeight;
      const left=Math.max(12,Math.min(anchorRect.left,viewportWidth-popoverWidth-12));
      const below=anchorRect.bottom+6;
      const above=anchorRect.top-6-popoverHeight;
      const top=below+popoverHeight<=viewportHeight-12||above<12?Math.max(12,below):above;
      setPopoverPosition(hostRect
        ?{left:left-hostRect.left,top:top-hostRect.top}
        :{left:left+window.scrollX,top:top+window.scrollY});
    };
    setPopoverPosition(null);
    align();
    window.addEventListener('resize',align);
    window.addEventListener('scroll',align,true);
    window.visualViewport?.addEventListener('resize',align);
    return()=>{
      window.removeEventListener('resize',align);
      window.removeEventListener('scroll',align,true);
      window.visualViewport?.removeEventListener('resize',align);
    };
  },[isOpen]);

  const initialDate = value ? parseIso(value) : new Date();
  const [viewYear, setViewYear] = useState(initialDate.getFullYear());
  const [viewMonth, setViewMonth] = useState(initialDate.getMonth());

  // Update view when value changes externally
  useEffect(() => {
    if (value) {
      const d = parseIso(value);
      setViewYear(d.getFullYear());
      setViewMonth(d.getMonth());
    }
  }, [value]);

  useDismissablePopover(isOpen, [containerRef, popoverRef], () => {
    setActiveDropdown(null);
    setIsOpen(false);
    setPopoverPosition(null);
  });

  useEffect(()=>{
    if(!isOpen)return;
    const handleEscape=(event:KeyboardEvent)=>{
      if(event.key==='Escape'&&!activeDropdown){event.preventDefault();closeCalendar();}
    };
    document.addEventListener('keydown',handleEscape);
    return()=>document.removeEventListener('keydown',handleEscape);
  },[isOpen,activeDropdown]);

  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
  const firstDayOfWeek = new Date(viewYear, viewMonth, 1).getDay(); // 0 = Sun
  const minimumYear = min ? parseIso(min).getFullYear() : 1900;
  const maximumYear = max ? parseIso(max).getFullYear() : Math.max(new Date().getFullYear(), viewYear);
  const calendarYears = Array.from({length:Math.max(1,maximumYear-minimumYear+1)},(_,index)=>minimumYear+index);
  const monthOptions = MONTHS.map((month, index) => ({value: index, label: month}));
  const yearOptions = calendarYears.map(year => ({value: year, label: String(year)}));

  const prevMonth = () => {
    setActiveDropdown(null);
    if (viewMonth === 0) {
      setViewMonth(11);
      setViewYear(y => y - 1);
    } else {
      setViewMonth(m => m - 1);
    }
  };

  const nextMonth = () => {
    setActiveDropdown(null);
    if (viewMonth === 11) {
      setViewMonth(0);
      setViewYear(y => y + 1);
    } else {
      setViewMonth(m => m + 1);
    }
  };

  const handleSelectDay = (day: number) => {
    setActiveDropdown(null);
    const selected = new Date(viewYear, viewMonth, day);
    const iso = toIso(selected);
    onChange(iso);
    closeCalendar();
  };

  const todayIso = toIso(new Date());

  // Build grid of 42 cells (6 weeks)
  const prevMonthDays = new Date(viewYear, viewMonth, 0).getDate();
  const cells: {day: number; currentMonth: boolean; iso: string}[] = [];

  // Previous month trailing days
  for (let i = firstDayOfWeek - 1; i >= 0; i--) {
    const d = prevMonthDays - i;
    const pm = viewMonth === 0 ? 11 : viewMonth - 1;
    const py = viewMonth === 0 ? viewYear - 1 : viewYear;
    cells.push({
      day: d,
      currentMonth: false,
      iso: toIso(new Date(py, pm, d)),
    });
  }

  // Current month days
  for (let d = 1; d <= daysInMonth; d++) {
    cells.push({
      day: d,
      currentMonth: true,
      iso: toIso(new Date(viewYear, viewMonth, d)),
    });
  }

  // Next month leading days
  const remaining = 42 - cells.length;
  for (let d = 1; d <= remaining; d++) {
    const nm = viewMonth === 11 ? 0 : viewMonth + 1;
    const ny = viewMonth === 11 ? viewYear + 1 : viewYear;
    cells.push({
      day: d,
      currentMonth: false,
      iso: toIso(new Date(ny, nm, d)),
    });
  }

  return (
    <FieldFrame label={label} validate={validate} className={`field date-picker-field ${className}`.trim()} ref={containerRef} onKeyDown={event=>{if(isOpen&&event.key==='Tab'){closeCalendar();return;}if(!activeDropdown&&isOpen&&event.key==='Escape'){event.preventDefault();event.stopPropagation();closeCalendar();}}}>
      <label htmlFor={id} className="date-picker-label">
        <span>{label}</span>
      </label>

      <div className="date-picker-wrapper">
        <button
          ref={triggerRef}
          data-validation-focus
          aria-label={`Choose ${label.toLowerCase()}`}
          aria-describedby={[`${id}-value`,hint?`${id}-hint`:undefined].filter(Boolean).join(' ')}
          type="button"
          id={`${id}-trigger`}
          className={`custom-date-trigger ${isOpen ? 'open' : ''} ${disabled ? 'disabled' : ''}`}
          onClick={() => !disabled && setIsOpen(o => !o)}
          disabled={disabled}
          aria-haspopup="dialog"
          aria-expanded={isOpen}
        >
          <span id={`${id}-value`} className="date-display">{formatDisplay(value)}</span>
          <Calendar size={18} className="date-icon" />
        </button>

        {/* Underlying native input kept synced for form submission & automated tools */}
        <input
          id={id}
          name={name}
          type="date"
          value={value}
          onChange={e => onChange(e.target.value)}
          min={min}
          max={max}
          required={required}
          disabled={disabled}
          className="accessible-native-date"
          tabIndex={-1}
          aria-hidden="true"
        />

        {isOpen&&createPortal(
          <div ref={popoverRef} className="custom-calendar-popover" role="dialog" aria-label={label}
            style={{left:popoverPosition?.left??0,top:popoverPosition?.top??0,visibility:popoverPosition?'visible':'hidden'}}>
            <div className="calendar-header">
              <div className="calendar-nav-group">
                <button type="button" className="calendar-nav-btn" onClick={prevMonth} aria-label="Previous month">
                  <ChevronLeft size={16} />
                </button>
              </div>
              <div className="calendar-title-controls">
                <CalendarDropdown
                  id={`${id}-month`}
                  name={`${name}_month`}
                  label="Choose month"
                  value={viewMonth}
                  options={monthOptions}
                  onChange={m => setViewMonth(m)}
                  isOpen={activeDropdown === 'month'}
                  onToggle={() => setActiveDropdown(curr => curr === 'month' ? null : 'month')}
                  onClose={() => setActiveDropdown(null)}
                  selectClassName="calendar-title-select"
                />
                <CalendarDropdown
                  id={`${id}-year`}
                  name={`${name}_year`}
                  label="Choose year"
                  value={viewYear}
                  options={yearOptions}
                  onChange={y => setViewYear(y)}
                  isOpen={activeDropdown === 'year'}
                  onToggle={() => setActiveDropdown(curr => curr === 'year' ? null : 'year')}
                  onClose={() => setActiveDropdown(null)}
                  selectClassName="calendar-title-select calendar-year-select"
                  menuClassName="year-menu"
                />
              </div>
              <div className="calendar-nav-group">
                <button type="button" className="calendar-nav-btn" onClick={nextMonth} aria-label="Next month">
                  <ChevronRight size={16} />
                </button>
              </div>
            </div>

            <div className="calendar-weekdays">
              {WEEKDAYS.map((wd, i) => (
                <span key={i} className="weekday-header">
                  {wd}
                </span>
              ))}
            </div>

            <div className="calendar-grid">
              {cells.map((cell, idx) => {
                const isSelected = cell.iso === value;
                const isToday = cell.iso === todayIso;
                const isOutOfBounds = Boolean((min && cell.iso < min) || (max && cell.iso > max));
                const isDisabled = !cell.currentMonth || isOutOfBounds;

                return (
                  <button
                    key={idx}
                    type="button"
                    disabled={isDisabled}
                    className={`calendar-day-btn ${cell.currentMonth ? 'current-month' : 'other-month'} ${
                      isSelected ? 'selected' : ''
                    } ${isToday ? 'today' : ''}`}
                    onClick={() => handleSelectDay(cell.day)}
                  >
                    {cell.day}
                  </button>
                );
              })}
            </div>

            <div className="calendar-footer">
              <button
                type="button"
                className="calendar-action-btn"
                onClick={() => {
                  const now = new Date();
                  const iso = toIso(now);
                  if ((!min || iso >= min) && (!max || iso <= max)) {
                    onChange(iso);
                    closeCalendar();
                  }
                }}
              >
                Today
              </button>
              <button
                type="button"
                className="calendar-action-btn secondary"
                onClick={closeCalendar}
              >
                Close
              </button>
            </div>
          </div>,
          containerRef.current?.closest('dialog')??document.body
        )}
      </div>

      {hint && <small id={`${id}-hint`}>{hint}</small>}
    </FieldFrame>
  );
}
