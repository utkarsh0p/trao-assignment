'use client';

import { forwardRef, useId } from 'react';
import { cx } from '@/lib/cx';

const BASE =
  'w-full rounded-lg border bg-surface px-3 text-[15px] text-text placeholder:text-text-faint ' +
  'transition-colors duration-150 disabled:cursor-not-allowed disabled:bg-bg-subtle';

/** Label, control, and a described error slot. Never a bare input. */
function Wrapper({ id, label, hint, error, children, className }) {
  return (
    <div className={cx('flex flex-col gap-1.5', className)}>
      <label htmlFor={id} className="text-xs font-medium text-text">
        {label}
      </label>
      {children}
      {hint && !error ? (
        <p id={`${id}-hint`} className="text-xs text-text-muted">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={`${id}-error`} className="text-xs font-medium text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export const Input = forwardRef(function Input(
  { label, hint, error, className, id: providedId, ...rest },
  ref,
) {
  const fallbackId = useId();
  const id = providedId || fallbackId;

  return (
    <Wrapper id={id} label={label} hint={hint} error={error} className={className}>
      <input
        ref={ref}
        id={id}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-error` : hint ? `${id}-hint` : undefined}
        className={cx(BASE, 'h-11', error ? 'border-danger' : 'border-border hover:border-border-strong')}
        {...rest}
      />
    </Wrapper>
  );
});

export const Textarea = forwardRef(function Textarea(
  { label, hint, error, className, rows = 8, id: providedId, ...rest },
  ref,
) {
  const fallbackId = useId();
  const id = providedId || fallbackId;

  return (
    <Wrapper id={id} label={label} hint={hint} error={error} className={className}>
      <textarea
        ref={ref}
        id={id}
        rows={rows}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-error` : hint ? `${id}-hint` : undefined}
        className={cx(
          BASE,
          'resize-y py-2.5 leading-relaxed',
          error ? 'border-danger' : 'border-border hover:border-border-strong',
        )}
        {...rest}
      />
    </Wrapper>
  );
});

export const Select = forwardRef(function Select(
  { label, hint, error, className, children, id: providedId, ...rest },
  ref,
) {
  const fallbackId = useId();
  const id = providedId || fallbackId;

  return (
    <Wrapper id={id} label={label} hint={hint} error={error} className={className}>
      <select
        ref={ref}
        id={id}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-error` : hint ? `${id}-hint` : undefined}
        className={cx(BASE, 'h-11', error ? 'border-danger' : 'border-border hover:border-border-strong')}
        {...rest}
      >
        {children}
      </select>
    </Wrapper>
  );
});
