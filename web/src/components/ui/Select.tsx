import {FieldFrame} from './Form';
import {
  Children,
  isValidElement,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import {createPortal} from 'react-dom';
import {Check, ChevronDown} from 'lucide-react';
import {useDismissablePopover} from './useDismissablePopover';
import {useViewportAlign} from './useViewportAlign';

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

  const [menuStyle, setMenuStyle] = useState<CSSProperties | null>(null);

  useDismissablePopover(isOpen, [containerRef, listRef], () => setIsOpen(false));

  const alignMenu = () => {
    const trigger = triggerRef.current;
    const menu = listRef.current;
    if (!trigger) return;

    const anchorRect = trigger.getBoundingClientRect();
    const host = containerRef.current?.closest('dialog') ?? trigger.closest('dialog');
    const hostRect = host?.getBoundingClientRect();

    const vv = window.visualViewport;
    const viewportHeight = vv?.height ?? window.innerHeight;
    const viewportWidth = vv?.width ?? window.innerWidth;

    const width = Math.min(Math.max(anchorRect.width, 140), viewportWidth - 16);
    const spaceBelow = viewportHeight - anchorRect.bottom - 6;
    const spaceAbove = anchorRect.top - 6;

    const menuHeight = menu ? menu.offsetHeight : 240;
    const flipAbove = spaceBelow < menuHeight && spaceAbove > spaceBelow;

    let top: number;
    let maxHeight: number;

    if (flipAbove) {
      maxHeight = Math.min(240, Math.max(60, spaceAbove));
      const effectiveHeight = menu ? Math.min(menu.scrollHeight + 10, maxHeight) : maxHeight;
      top = anchorRect.top - 6 - effectiveHeight;
    } else {
      maxHeight = Math.min(240, Math.max(60, spaceBelow));
      top = anchorRect.bottom + 6;
    }

    const left = Math.max(8, Math.min(anchorRect.left, viewportWidth - width - 8));

    setMenuStyle({
      left: hostRect ? `${left - hostRect.left}px` : `${left + window.scrollX}px`,
      top: hostRect ? `${top - hostRect.top}px` : `${top + window.scrollY}px`,
      width: `${width}px`,
      maxHeight: `${maxHeight}px`,
    });
  };
  // Closing drops the placement so the next opening measures afresh; the menu stays hidden until then.
  useLayoutEffect(() => { if (!isOpen) setMenuStyle(null); }, [isOpen]);
  useViewportAlign(isOpen, alignMenu, listRef);

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
      <label htmlFor={selectId} className="select-label" onClick={e => { e.preventDefault(); triggerRef.current?.focus(); setIsOpen(open => !open); }}>
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
          onFocus={() => triggerRef.current?.focus()}
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

        {isOpen && createPortal(
          <ul
            id={`${selectId}-list`}
            ref={listRef}
            className="custom-select-menu"
            role="listbox"
            aria-label={label}
            tabIndex={-1}
            style={menuStyle ?? {visibility: 'hidden'}}
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
                  onMouseMove={event => {
                    // Opening/repositioning under a stationary pointer must not undo keyboard navigation.
                    if (!opt.disabled && (event.movementX || event.movementY)) setFocusedIndex(idx);
                  }}
                >
                  <span className="option-label">{opt.label}</span>
                  {isSelected && <Check size={14} className="option-check" />}
                </li>
              );
            })}
          </ul>,
          containerRef.current?.closest('dialog') ?? triggerRef.current?.closest('dialog') ?? document.body
        )}
      </div>

      {hint && <small id={`${selectId}-hint`}>{hint}</small>}
    </FieldFrame>
  );
}

// SelectField exported as an alias for direct drop-in replacement
export const SelectField = Select;
