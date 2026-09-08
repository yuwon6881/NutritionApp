import type {ButtonHTMLAttributes} from 'react';

export type ButtonVariant = 'primary' | 'secondary' | 'tertiary' | 'destructive';
export type ButtonSize = 'sm' | 'md' | 'lg';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  fullWidth?: boolean;
}

export function Button({
  variant = 'secondary',
  size = 'md',
  fullWidth = false,
  className = '',
  children,
  ...props
}: ButtonProps) {
  const sizeClass = size ? `size-${size}` : '';
  const widthClass = fullWidth ? 'btn-full' : '';
  return (
    <button
      className={`button ${variant} ${sizeClass} ${widthClass} ${className}`.trim()}
      {...props}
    >
      {children}
    </button>
  );
}
