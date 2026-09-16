import type {KeyboardEvent} from 'react';

export interface MiniUnitOption<T extends string> {
  value: T;
  label: string;
  ariaLabel?: string;
}

export function MiniUnitToggle<T extends string>({
  label,
  value,
  options,
  onChange,
  id
}: {
  label: string;
  value: T;
  options: readonly MiniUnitOption<T>[];
  onChange: (value: T) => void;
  id?: string;
}) {
  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
      event.preventDefault();
      const next = (index + 1) % options.length;
      onChange(options[next].value);
    } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
      event.preventDefault();
      const prev = (index - 1 + options.length) % options.length;
      onChange(options[prev].value);
    }
  };

  return (
    <div className="mini-unit-toggle" role="group" aria-label={label} id={id}>
      {options.map((option, index) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            className={`mini-unit-btn ${active ? 'active' : ''}`}
            aria-pressed={active}
            aria-label={option.ariaLabel ?? `${option.label} (${label})`}
            onClick={() => onChange(option.value)}
            onKeyDown={event => onKeyDown(event, index)}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
