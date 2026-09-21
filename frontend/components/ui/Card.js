'use client';

import { cx } from '@/lib/cx';
import { PencilIcon, PinIcon } from './icons';

/**
 * The origin marker is the state model made visible: before regenerating a
 * section the user has to see at a glance what will survive. Quiet on purpose
 * — a left border and a small icon, never a badge.
 */
const ORIGIN_BORDER = {
  generated: '',
  edited: 'border-l-[3px] border-l-accent',
  pinned: 'border-l-[3px] border-l-success',
};

export function OriginMark({ origin }) {
  if (origin === 'edited') {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-text-muted">
        <PencilIcon className="h-3 w-3" />
        Edited
      </span>
    );
  }
  if (origin === 'pinned') {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-success">
        <PinIcon className="h-3 w-3" />
        Yours
      </span>
    );
  }
  return null;
}

export default function Card({
  as: Tag = 'div',
  interactive = false,
  origin = 'generated',
  className,
  children,
  ...rest
}) {
  return (
    <Tag
      className={cx(
        // Padding drops to p-4 below md — keep the rhythm, lose the luxury.
        'rounded-xl border border-border bg-surface p-4 md:p-6',
        interactive && 'transition-shadow duration-150 hover:shadow-sm hover:border-border-strong',
        ORIGIN_BORDER[origin] || '',
        className,
      )}
      {...rest}
    >
      {children}
    </Tag>
  );
}
