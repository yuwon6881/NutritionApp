import {useRef,useCallback,type KeyboardEvent,type PointerEvent,type ReactNode} from 'react';
import {FieldFrame} from './Form';

export interface SliderProps {
  id: string;
  name: string;
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  hint?: string;
  ariaLabel?: string;
  valueDisplay?: ReactNode;
  formatValue?: (val: number) => string;
  onChange: (value: number) => void;
  className?: string;
}

export function Slider({
  id,
  name,
  label,
  value,
  min,
  max,
  step = 0.05,
  hint,
  ariaLabel,
  valueDisplay,
  formatValue,
  onChange,
  className = ''
}: SliderProps) {
  const trackRef = useRef<HTMLDivElement>(null);
  const isDragging = useRef(false);

  const clampAndSnap = useCallback((raw: number) => {
    const clamped = Math.min(Math.max(raw, min), max);
    const steps = Math.round((clamped - min) / step);
    const snapped = Number((min + steps * step).toFixed(4));
    return Math.min(Math.max(snapped, min), max);
  }, [min, max, step]);

  const updateFromPointer = useCallback((clientX: number) => {
    if (!trackRef.current) return;
    const rect = trackRef.current.getBoundingClientRect();
    if (rect.width <= 0) return;
    const ratio = (clientX - rect.left) / rect.width;
    const rawValue = min + ratio * (max - min);
    const nextValue = clampAndSnap(rawValue);
    if (nextValue !== value) {
      onChange(nextValue);
    }
  }, [min, max, clampAndSnap, value, onChange]);

  const handlePointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return; // Primary click only
    isDragging.current = true;
    e.currentTarget.setPointerCapture(e.pointerId);
    updateFromPointer(e.clientX);
  };

  const handlePointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (!isDragging.current) return;
    updateFromPointer(e.clientX);
  };

  const handlePointerUp = (e: PointerEvent<HTMLDivElement>) => {
    if (isDragging.current) {
      isDragging.current = false;
      try {
        e.currentTarget.releasePointerCapture(e.pointerId);
      } catch {
        // Ignore if pointer capture was already released
      }
    }
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    let next = value;
    switch (e.key) {
      case 'ArrowRight':
      case 'ArrowUp':
        next = clampAndSnap(value + step);
        break;
      case 'ArrowLeft':
      case 'ArrowDown':
        next = clampAndSnap(value - step);
        break;
      case 'PageUp':
        next = clampAndSnap(value + step * 5);
        break;
      case 'PageDown':
        next = clampAndSnap(value - step * 5);
        break;
      case 'Home':
        next = min;
        break;
      case 'End':
        next = max;
        break;
      default:
        return;
    }
    e.preventDefault();
    if (next !== value) {
      onChange(next);
    }
  };

  const percent = Math.min(Math.max(((value - min) / (max - min)) * 100, 0), 100);
  const formattedText = formatValue ? formatValue(value) : `${value}`;

  return (
    <FieldFrame label={label} className={`field slider-field ${className}`.trim()}>
      <div className="field-label-row">
        <label htmlFor={id}>{label}</label>
        <div className="slider-value-display">
          {valueDisplay ?? <span className="slider-current-badge">{formattedText}</span>}
        </div>
      </div>

      <div
        id={id}
        ref={trackRef}
        className="custom-slider"
        role="slider"
        tabIndex={0}
        aria-label={ariaLabel ?? label}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={value}
        aria-valuetext={formattedText}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onKeyDown={handleKeyDown}
      >
        <div className="custom-slider-track">
          <div className="custom-slider-fill" style={{width: `${percent}%`}} />
        </div>
        <div
          className="custom-slider-thumb"
          style={{left: `${percent}%`}}
          aria-hidden="true"
        />
        <input type="hidden" name={name} value={value} />
      </div>

      {hint && <small id={`${id}-hint`}>{hint}</small>}
    </FieldFrame>
  );
}
