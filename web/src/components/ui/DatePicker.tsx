import {useEffect, useId, useRef, useState} from 'react';
import {Calendar, ChevronLeft, ChevronRight} from 'lucide-react';

export interface DatePickerProps {
  label: string;
  value: string; // ISO yyyy-mm-dd
  onChange: (value: string) => void;
  min?: string;
  max?: string;
  required?: boolean;
  disabled?: boolean;
  hint?: string;
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
  className = '',
}: DatePickerProps) {
  const id = useId();
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

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

  // Click outside listener
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

  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
  const firstDayOfWeek = new Date(viewYear, viewMonth, 1).getDay(); // 0 = Sun

  const prevMonth = () => {
    if (viewMonth === 0) {
      setViewMonth(11);
      setViewYear(y => y - 1);
    } else {
      setViewMonth(m => m - 1);
    }
  };

  const nextMonth = () => {
    if (viewMonth === 11) {
      setViewMonth(0);
      setViewYear(y => y + 1);
    } else {
      setViewMonth(m => m + 1);
    }
  };

  const handleSelectDay = (day: number) => {
    const selected = new Date(viewYear, viewMonth, day);
    const iso = toIso(selected);
    onChange(iso);
    setIsOpen(false);
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
    <div className={`field date-picker-field ${className}`.trim()} ref={containerRef}>
      <label htmlFor={id} className="date-picker-label">
        <span>{label}</span>
      </label>

      <div className="date-picker-wrapper">
        <button
          type="button"
          id={`${id}-trigger`}
          className={`custom-date-trigger ${isOpen ? 'open' : ''} ${disabled ? 'disabled' : ''}`}
          onClick={() => !disabled && setIsOpen(o => !o)}
          disabled={disabled}
          aria-haspopup="dialog"
          aria-expanded={isOpen}
        >
          <span className="date-display">{formatDisplay(value)}</span>
          <Calendar size={18} className="date-icon" />
        </button>

        {/* Underlying native input kept synced for form submission & automated tools */}
        <input
          id={id}
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

        {isOpen && (
          <div className="custom-calendar-popover" role="dialog" aria-modal="true" aria-label={label}>
            <div className="calendar-header">
              <button
                type="button"
                className="calendar-nav-btn"
                onClick={prevMonth}
                aria-label="Previous month"
              >
                <ChevronLeft size={16} />
              </button>
              <span className="calendar-title">
                {MONTHS[viewMonth]} {viewYear}
              </span>
              <button
                type="button"
                className="calendar-nav-btn"
                onClick={nextMonth}
                aria-label="Next month"
              >
                <ChevronRight size={16} />
              </button>
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
                    setIsOpen(false);
                  }
                }}
              >
                Today
              </button>
              <button
                type="button"
                className="calendar-action-btn secondary"
                onClick={() => setIsOpen(false)}
              >
                Close
              </button>
            </div>
          </div>
        )}
      </div>

      {hint && <small>{hint}</small>}
    </div>
  );
}
