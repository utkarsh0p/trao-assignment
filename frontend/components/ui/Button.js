'use client';

import { forwardRef } from 'react';
import { cx } from '@/lib/cx';

const VARIANTS = {
  primary: 'bg-accent text-white hover:bg-accent-hover border border-transparent',
  secondary:
    'bg-surface border border-border text-text hover:bg-bg-subtle hover:border-border-strong',
  ghost: 'border border-transparent text-text-muted hover:bg-bg-subtle hover:text-text',
  danger: 'bg-surface border border-danger text-danger hover:bg-danger-subtle',
};

// Phone tap targets are a minimum of 44px, so `md` is h-11 rather than h-10.
const SIZES = {
  sm: 'h-11 px-3 text-xs gap-1.5 md:h-9',
  md: 'h-11 px-4 text-sm gap-2',
};

const Button = forwardRef(function Button(
  {
    as: Tag = 'button',
    variant = 'secondary',
    size = 'md',
    className,
    type = 'button',
    loading,
    children,
    ...rest
  },
  ref,
) {
  // `as` lets a next/link render with button styling without duplicating them.
  const isButton = Tag === 'button';

  return (
    <Tag
      ref={ref}
      type={isButton ? type : undefined}
      aria-busy={loading || undefined}
      disabled={isButton ? rest.disabled || loading : undefined}
      className={cx(
        'inline-flex items-center justify-center rounded-lg font-medium transition-colors duration-150',
        'disabled:cursor-not-allowed disabled:opacity-50',
        VARIANTS[variant],
        SIZES[size],
        className,
      )}
      {...rest}
    >
      {loading ? <Spinner /> : null}
      {children}
    </Tag>
  );
});

export function Spinner({ className }) {
  return (
    <span
      className={cx(
        'inline-block h-3.5 w-3.5 shrink-0 animate-spin rounded-full border-2 border-current border-r-transparent',
        className,
      )}
      aria-hidden="true"
    />
  );
}

export default Button;
