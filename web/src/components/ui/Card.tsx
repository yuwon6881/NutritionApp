import type {HTMLAttributes, ReactNode} from 'react';

export interface CardProps extends HTMLAttributes<HTMLElement> {
  as?: 'section' | 'article' | 'div';
  variant?: 'default' | 'elevated' | 'tint' | 'accent';
  className?: string;
  children?: ReactNode;
}

export function Card({
  as: Component = 'section',
  variant = 'default',
  className = '',
  children,
  ...props
}: CardProps) {
  const variantClass = variant !== 'default' ? `card-${variant}` : '';
  return (
    <Component className={`panel ${variantClass} ${className}`.trim()} {...props}>
      {children}
    </Component>
  );
}
