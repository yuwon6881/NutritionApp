import {forwardRef, type ButtonHTMLAttributes} from 'react';

export type ButtonVariant = 'primary' | 'secondary' | 'tertiary' | 'destructive';
export type ButtonSize = 'sm' | 'md' | 'lg' | 'icon';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  fullWidth?: boolean;
  presentation?: 'control' | 'plain';
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button({
  variant = 'secondary',
  size = 'md',
  fullWidth = false,
  presentation = 'control',
  type = 'button',
  className = '',
  children,
  ...props
}, ref) {
  const sizeClass = presentation === 'control' && size ? `size-${size}` : '';
  const widthClass = presentation === 'control' && fullWidth ? 'btn-full' : '';
  const controlClass = presentation === 'control' ? `button ${variant}` : '';
  return (
    <button
      ref={ref}
      type={type}
      className={`${controlClass} ${sizeClass} ${widthClass} ${className}`.trim()}
      {...props}
    >
      {children}
    </button>
  );
});
