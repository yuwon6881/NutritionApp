import type {ReactNode} from 'react';

export interface CheckboxProps {
  id?:string;
  name?:string;
  checked:boolean;
  onChange:(checked:boolean)=>void;
  disabled?:boolean;
  role?:string;
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
  role,
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
        role={role}
        aria-checked={role==='switch'?checked:undefined}
        checked={checked}
        disabled={disabled}
        aria-label={ariaLabel}
        onChange={e=>onChange(e.target.checked)}
      />
      {children}
    </label>
  );
}
