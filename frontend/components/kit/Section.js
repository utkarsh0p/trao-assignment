'use client';

import { cx } from '@/lib/cx';

export default function Section({ id, title, count, description, actions, children, className }) {
  return (
    <section id={id} className={cx('scroll-mt-24', className)}>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-baseline gap-3">
          <h2 className="text-xl font-semibold leading-snug text-text">{title}</h2>
          {count != null ? (
            <span className="rounded-full bg-bg-subtle px-2 py-0.5 text-xs font-medium text-text-muted">
              {count}
            </span>
          ) : null}
        </div>
        {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
      {description ? (
        <p className="mb-4 max-w-[68ch] text-[15px] leading-relaxed text-text-muted">{description}</p>
      ) : null}
      {children}
    </section>
  );
}
