import type {ButtonHTMLAttributes} from 'react';
export function Button({variant='secondary',className='',children,...props}:ButtonHTMLAttributes<HTMLButtonElement>&{variant?:'primary'|'secondary'|'tertiary'|'destructive'}){
  return <button className={`button ${variant} ${className}`} {...props}>{children}</button>;
}
