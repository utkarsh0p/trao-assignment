'use client';

import { cx } from '@/lib/cx';
import { Spinner } from './Button';
import { AlertIcon, CheckIcon, SkippedIcon } from './icons';

/**
 * `skipped` is a first-class outcome, not a failure, so it is muted rather
 * than red. That distinction is the whole point of the honesty rule.
 */
const STATUS = {
  queued: { label: 'Queued', className: 'bg-bg-subtle text-text-muted' },
  running: { label: 'Generating', className: 'bg-accent-subtle text-accent' },
  regenerating: { label: 'Regenerating', className: 'bg-accent-subtle text-accent' },
  ready: { label: 'Ready', className: 'bg-success-subtle text-success' },
  failed: { label: 'Failed', className: 'bg-danger-subtle text-danger' },
  skipped: { label: 'Skipped', className: 'bg-bg-subtle text-text-muted' },
};

export default function Badge({ status, children, className }) {
  const spec = STATUS[status] || STATUS.queued;
  const busy = status === 'running' || status === 'regenerating';

  return (
    <span
      className={cx(
        'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium',
        spec.className,
        className,
      )}
    >
      {busy ? <Spinner className="h-3 w-3 border-[1.5px]" /> : null}
      {status === 'ready' ? <CheckIcon className="h-3 w-3" /> : null}
      {status === 'failed' ? <AlertIcon className="h-3 w-3" /> : null}
      {status === 'skipped' ? <SkippedIcon className="h-3 w-3" /> : null}
      {children || spec.label}
    </span>
  );
}
