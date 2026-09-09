import type {ReactNode} from 'react';

export interface CheckboxProps {
  id?:string;
  name?:string;
  checked:boolean;
  onChange:(checked:boolean)=>void;
  disabled?:boolean;
  'aria-label'?:string;
  className?:string;
  children?:ReactNode;
}

export function Checkbox({
  id,
  name,
  checked,
  onChange,
  disabled=false,
  'aria-label':ariaLabel,
  className='',
  children,
}:CheckboxProps){
  return (
    <label className={`check-row ${className}`.trim()} htmlFor={id}>
      <input
        id={id}
        name={name}
        type="checkbox"
        checked={checked}
        disabled={disabled}
        aria-label={ariaLabel}
        onChange={e=>onChange(e.target.checked)}
      />
      {children}
    </label>
  );
}
