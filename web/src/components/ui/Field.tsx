import type {InputHTMLAttributes} from 'react';
import {Select} from './Select';

export function Field({
  label,
  hint,
  className = '',
  ...props
}: InputHTMLAttributes<HTMLInputElement> & {label: string; hint?: string}) {
  return (
    <label className={`field ${className}`.trim()}>
      <span>{label}</span>
      <input {...props} />
      {hint && <small>{hint}</small>}
    </label>
  );
}

export {Select, Select as SelectField} from './Select';
