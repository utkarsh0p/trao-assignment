'use client';

import { cx } from '@/lib/cx';
import { AlertIcon, CheckIcon, InfoIcon } from './icons';

/**
 * Subtle fill, full-strength text and icon. Never a saturated block of colour.
 * Used for the source notes, coverage gaps and the failed-regeneration case.
 */
const TONES = {
  info: { className: 'bg-accent-subtle text-accent', Icon: InfoIcon },
  success: { className: 'bg-success-subtle text-success', Icon: CheckIcon },
  warn: { className: 'bg-warn-subtle text-warn', Icon: AlertIcon },
  danger: { className: 'bg-danger-subtle text-danger', Icon: AlertIcon },
};

export default function Notice({ tone = 'info', title, children, action, className }) {
  const { className: toneClass, Icon } = TONES[tone] || TONES.info;

  return (
    <div className={cx('rounded-xl border border-border p-4', toneClass, className)}>
      <div className="flex gap-3">
        <Icon className="mt-0.5 h-4 w-4 shrink-0" />
        <div className="min-w-0 flex-1">
          {title ? <p className="text-sm font-medium">{title}</p> : null}
          {children ? (
            <div className={cx('text-[15px] leading-relaxed text-text', title && 'mt-1')}>
              {children}
            </div>
          ) : null}
          {action ? <div className="mt-3">{action}</div> : null}
        </div>
      </div>
    </div>
  );
}
