import {useRef,useCallback,type KeyboardEvent,type ReactNode} from 'react';
import {FieldFrame} from './Form';
import {usePointerGesture} from './usePointerGesture';

export interface SliderProps {
  id: string;
  name: string;
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  hint?: ReactNode;
  ariaLabel?: string;
  valueDisplay?: ReactNode;
  formatValue?: (val: number) => string;
  onChange: (value: number) => void;
  className?: string;
  recommendedRange?: [number, number];
  recommendedLabel?: string;
  showLabel?: boolean;
  disabled?: boolean;
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
  className = '',
  recommendedRange,
  recommendedLabel,
  showLabel = true,
  disabled = false
}: SliderProps) {
  const trackRef = useRef<HTMLDivElement>(null);
  const clampAndSnap = useCallback((raw: number) => {
    const clamped = Math.min(Math.max(raw, min), max);
    const steps = Math.round((clamped - min) / step);
    const snapped = Number((min + steps * step).toFixed(4));
    return Math.min(Math.max(snapped, min), max);
  }, [min, max, step]);

  const updateFromPointer = useCallback((clientX: number) => {
    if (!trackRef.current) return;
    const rect = gesture.geometry.read();
    if(!rect)return;
    if (rect.width <= 0) return;
    const ratio = (clientX - rect.left) / rect.width;
    const rawValue = min + ratio * (max - min);
    const nextValue = clampAndSnap(rawValue);
    if (nextValue !== value) {
      onChange(nextValue);
    }
  }, [min, max, clampAndSnap, value, onChange]);

  const gesture=usePointerGesture(trackRef,(x)=>updateFromPointer(x),!disabled);
  const isSliding=gesture.dragging;

  const valueRef = useRef(value);
  valueRef.current = value;

  const handleKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (disabled) return;
    gesture.cancel();
    const current = valueRef.current;
    let next = current;
    switch (e.key) {
      case 'ArrowRight':
      case 'ArrowUp':
        next = clampAndSnap(current + step);
        break;
      case 'ArrowLeft':
      case 'ArrowDown':
        next = clampAndSnap(current - step);
        break;
      case 'PageUp':
        next = clampAndSnap(current + step * 5);
        break;
      case 'PageDown':
        next = clampAndSnap(current - step * 5);
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
    if (next !== current) {
      valueRef.current = next;
      onChange(next);
    }
  };

  const percent = Math.min(Math.max(((value - min) / (max - min)) * 100, 0), 100);
  const formattedText = formatValue ? formatValue(value) : `${value}`;

  const hasRec = recommendedRange && recommendedRange.length === 2;
  const recMinVal = hasRec ? Math.min(recommendedRange[0], recommendedRange[1]) : 0;
  const recMaxVal = hasRec ? Math.max(recommendedRange[0], recommendedRange[1]) : 0;
  const recMinPercent = hasRec
    ? Math.min(Math.max(((recMinVal - min) / (max - min)) * 100, 0), 100)
    : 0;
  const recMaxPercent = hasRec
    ? Math.min(Math.max(((recMaxVal - min) / (max - min)) * 100, 0), 100)
    : 0;
  const recWidth = recMaxPercent - recMinPercent;

  return (
    <FieldFrame label={label} className={`field slider-field ${className}`.trim()}>
      {showLabel && <div className="field-label-row">
        <span id={`${id}-label`} className="slider-label">{label}</span>
        <div className="slider-value-display">
          {valueDisplay ?? <span className="slider-current-badge">{formattedText}</span>}
        </div>
      </div>}

      <div
        id={id}
        ref={trackRef}
        className={`custom-slider${disabled ? ' is-disabled' : ''}${isSliding ? ' is-sliding' : ''}`}
        data-sliding={isSliding || undefined}
        role="slider"
        tabIndex={0}
        aria-labelledby={showLabel ? `${id}-label` : undefined}
        aria-label={showLabel ? (ariaLabel ?? undefined) : (ariaLabel ?? label)}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={value}
        aria-valuetext={formattedText}
        {...gesture.bind}
        onKeyDown={handleKeyDown}
        aria-disabled={disabled || undefined}
      >
        <div className="custom-slider-track">
          {hasRec && (
            <div
              className="custom-slider-zone recommended"
              style={{left: `${recMinPercent}%`, width: `${recWidth}%`}}
              aria-hidden="true"
              title={recommendedLabel ?? 'Recommended range'}
            />
          )}
          <div className="custom-slider-fill" style={{transform: `scaleX(${percent/100})`}} />
        </div>
        <div
          className="custom-slider-thumb"
          style={{left: `${percent}%`}}
          aria-hidden="true"
        />
        <input type="hidden" name={name} value={value} disabled={disabled} />
      </div>

      {hasRec && (
        <div className="slider-range-ticks" aria-hidden="true">
          <span style={{left: `${recMinPercent}%`}} className="tick-mark" />
          <span style={{left: `${recMaxPercent}%`}} className="tick-mark" />
          <div className="tick-label-container" style={{left: `${recMinPercent + recWidth / 2}%`}}>
            <span className="tick-label">{recommendedLabel ? `Recommended: ${recommendedLabel}` : 'Recommended'}</span>
          </div>
        </div>
      )}

      {hint && <small id={`${id}-hint`}>{hint}</small>}
    </FieldFrame>
  );
}

export {CircularSlider,type CircularSliderProps} from './CircularSlider';
