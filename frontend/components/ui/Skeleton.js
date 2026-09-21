'use client';

import { cx } from '@/lib/cx';

/** Shaped like the content it stands in for. Never a bare spinner on a page. */
export default function Skeleton({ className }) {
  return <div className={cx('animate-pulse rounded-lg bg-surface-sunken', className)} />;
}

export function SkeletonText({ lines = 3, className }) {
  return (
    <div className={cx('flex flex-col gap-2', className)}>
      {Array.from({ length: lines }, (_, i) => (
        <Skeleton key={i} className={cx('h-4', i === lines - 1 ? 'w-2/3' : 'w-full')} />
      ))}
    </div>
  );
}

export function SkeletonCard({ className }) {
  return (
    <div className={cx('rounded-xl border border-border bg-surface p-4 md:p-6', className)}>
      <Skeleton className="mb-4 h-4 w-1/3" />
      <SkeletonText lines={3} />
    </div>
  );
}

export function SkeletonList({ count = 3, className }) {
  return (
    <div className={cx('flex flex-col gap-4', className)}>
      {Array.from({ length: count }, (_, i) => (
        <SkeletonCard key={i} />
      ))}
    </div>
  );
}
