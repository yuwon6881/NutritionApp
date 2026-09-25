import {FieldFrame} from './Form';
import {
  Children,
  isValidElement,
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import {Check, ChevronDown} from 'lucide-react';
import {useDismissablePopover} from './useDismissablePopover';

export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

export interface SelectProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options?: SelectOption[];
  children?: ReactNode;
  disabled?: boolean;
  required?: boolean;
  hint?: string;
  validate?:()=>string|undefined;
  id?: string;
  name?: string;
  placeholder?: string;
  className?: string;
}

export function Select({
  label,
  value,
  onChange,
  options: optionsProp,
  children,
  disabled = false,
  required = false,
  hint,
  validate,
  id: idProp,
  name: nameProp,
  placeholder = 'Select an option',
  className = '',
}: SelectProps) {
  const generatedId = useId();
  const selectId = idProp ?? generatedId;
  const selectName = nameProp ?? idProp ?? selectId;
  const [isOpen, setIsOpen] = useState(false);
  const [focusedIndex, setFocusedIndex] = useState(-1);
  const containerRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  // Extract options either from prop or from <option> children
  const options: SelectOption[] = optionsProp ?? [];
  if (!optionsProp && children) {
    Children.forEach(children, child => {
      if (isValidElement(child)) {
        const props = child.props as {value?: string; children?: ReactNode; disabled?: boolean};
        options.push({
          value: String(props.value ?? ''),
          label: typeof props.children === 'string' ? props.children : String(props.children ?? props.value ?? ''),
          disabled: Boolean(props.disabled),
        });
      }
    });
  }

  const selectedOption = options.find(o => o.value === value);

  useDismissablePopover(isOpen, [containerRef], () => setIsOpen(false));

  // Scroll focused option into view
  useEffect(() => {
    if (isOpen && focusedIndex >= 0 && listRef.current) {
      const item = listRef.current.children[focusedIndex] as HTMLElement | undefined;
      item?.scrollIntoView({block: 'nearest'});
    }
  }, [isOpen, focusedIndex]);

  const handleSelect = (val: string) => {
    onChange(val);
    setIsOpen(false);
    triggerRef.current?.focus({preventScroll: true});
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (disabled) return;
    if (e.key === 'ArrowDown' || e.key === 'Down') {
      e.preventDefault();
      if (!isOpen) {
        setIsOpen(true);
        const idx = options.findIndex(o => o.value === value && !o.disabled);
        setFocusedIndex(idx >= 0 ? idx : 0);
      } else {
        setFocusedIndex(prev => {
          let next = prev + 1;
          while (next < options.length && options[next].disabled) next++;
          return next < options.length ? next : prev;
        });
      }
    } else if (e.key === 'ArrowUp' || e.key === 'Up') {
      e.preventDefault();
      if (!isOpen) {
        setIsOpen(true);
        const idx = options.findIndex(o => o.value === value && !o.disabled);
        setFocusedIndex(idx >= 0 ? idx : options.length - 1);
      } else {
        setFocusedIndex(prev => {
          let next = prev - 1;
          while (next >= 0 && options[next].disabled) next--;
          return next >= 0 ? next : prev;
        });
      }
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      if (isOpen) {
        if (focusedIndex >= 0 && focusedIndex < options.length && !options[focusedIndex].disabled) {
          handleSelect(options[focusedIndex].value);
        }
      } else {
        setIsOpen(true);
        const idx = options.findIndex(o => o.value === value && !o.disabled);
        setFocusedIndex(idx >= 0 ? idx : 0);
      }
    } else if (e.key === 'Escape') {
      if (isOpen) {
        e.preventDefault();
        e.stopPropagation();
        setIsOpen(false);
        triggerRef.current?.focus({preventScroll: true});
      }
    } else if (e.key === 'Tab') {
      setIsOpen(false);
    }
  };

  return (
    <FieldFrame label={label} validate={validate} className={`field select-field ${className}`.trim()} ref={containerRef}>
      <label htmlFor={selectId} className="select-label">
        <span>{label}</span>
      </label>

      <div className="custom-select-wrapper">
        <button
          ref={triggerRef}
          data-validation-focus
          aria-label={`Choose ${label.toLowerCase()}`}
          aria-describedby={[`${selectId}-value`,hint?`${selectId}-hint`:undefined].filter(Boolean).join(' ')}
          type="button"
          id={`${selectId}-btn`}
          className={`custom-select-trigger ${isOpen ? 'open' : ''} ${disabled ? 'disabled' : ''}`}
          onClick={() => !disabled && setIsOpen(open => !open)}
          onKeyDown={handleKeyDown}
          aria-haspopup="listbox"
          aria-expanded={isOpen}
          aria-controls={`${selectId}-list`}
          disabled={disabled}
        >
          <span id={`${selectId}-value`} className={`selected-text ${!selectedOption ? 'placeholder' : ''}`}>
            {selectedOption?.label || placeholder}
          </span>
          <ChevronDown size={16} className={`select-chevron ${isOpen ? 'rotated' : ''}`} />
        </button>

        {/* Native select element kept accessible and synced for Playwright, form submission, and screen readers */}
        <select
          id={selectId}
          name={selectName}
          value={value}
          onChange={e => onChange(e.target.value)}
          disabled={disabled}
          required={required}
          className="accessible-native-select"
          tabIndex={-1}
          aria-hidden="true"
        >
          {options.map(opt => (
            <option key={opt.value} value={opt.value} disabled={opt.disabled}>
              {opt.label}
            </option>
          ))}
        </select>

        {isOpen && (
          <ul
            id={`${selectId}-list`}
            ref={listRef}
            className="custom-select-menu"
            role="listbox"
            aria-label={label}
            tabIndex={-1}
          >
            {options.map((opt, idx) => {
              const isSelected = opt.value === value;
              const isFocused = idx === focusedIndex;
              return (
                <li
                  key={opt.value || `empty-${idx}`}
                  role="option"
                  aria-selected={isSelected}
                  aria-disabled={opt.disabled}
                  className={`custom-select-option ${isSelected ? 'selected' : ''} ${
                    isFocused ? 'focused' : ''
                  } ${opt.disabled ? 'disabled' : ''}`}
                  onClick={() => {
                    if (!opt.disabled) handleSelect(opt.value);
                  }}
                  onMouseEnter={() => {
                    if (!opt.disabled) setFocusedIndex(idx);
                  }}
                >
                  <span className="option-label">{opt.label}</span>
                  {isSelected && <Check size={14} className="option-check" />}
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {hint && <small id={`${selectId}-hint`}>{hint}</small>}
    </FieldFrame>
  );
}

// SelectField exported as an alias for direct drop-in replacement
export const SelectField = Select;
