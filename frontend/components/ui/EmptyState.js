'use client';

import { cx } from '@/lib/cx';

/** Say what would be here, and give the one action that creates it. */
export default function EmptyState({ icon: Icon, title, description, action, className }) {
  return (
    <div
      className={cx(
        'flex flex-col items-center justify-center rounded-xl border border-dashed border-border bg-bg-subtle px-6 py-12 text-center',
        className,
      )}
    >
      {Icon ? <Icon className="mb-3 h-6 w-6 text-text-faint" /> : null}
      {title ? <p className="text-base font-medium text-text">{title}</p> : null}
      {description ? (
        <p className="mt-1 max-w-[48ch] text-[15px] leading-relaxed text-text-muted">{description}</p>
      ) : null}
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  );
}
