'use client';

import { cx } from '@/lib/cx';
import { Spinner } from './Button';
import { AlertIcon, CheckIcon, SkippedIcon } from './icons';

/**
 * `⊘` is text-muted, never red. A company that publishes nothing about how it
 * hires is an honest outcome, not a failure, and showing it neutrally is part
 * of the point.
 */
function Glyph({ state }) {
  switch (state) {
    case 'done':
      return <CheckIcon className="h-4 w-4 text-success" />;
    case 'active':
      return <Spinner className="h-3.5 w-3.5 text-accent" />;
    case 'skipped':
      return <SkippedIcon className="h-4 w-4 text-text-muted" />;
    case 'failed':
      return <AlertIcon className="h-4 w-4 text-danger" />;
    default:
      return <span className="block h-3.5 w-3.5 rounded-full border border-border-strong" />;
  }
}

const STATE_WORD = {
  done: 'done',
  active: 'in progress',
  skipped: 'skipped',
  failed: 'failed',
  pending: 'not started',
};

function Row({ label, state, detail, nested = false }) {
  return (
    <li
      className={cx(
        'flex items-center gap-3 py-2',
        nested && 'pl-7',
        state === 'pending' && 'opacity-60',
      )}
    >
      <span className="flex h-4 w-4 shrink-0 items-center justify-center">
        <Glyph state={state} />
      </span>
      <span
        className={cx(
          'min-w-0 flex-1 truncate',
          nested ? 'text-xs text-text-muted' : 'text-[15px] text-text',
        )}
      >
        {label}
        <span className="sr-only"> — {STATE_WORD[state]}</span>
      </span>
      {detail ? <span className="shrink-0 text-xs text-text-muted">{detail}</span> : null}
    </li>
  );
}

export default function ProgressList({ rows, className }) {
  return (
    <ul className={cx('divide-y divide-border', className)}>
      {rows.map((row) => (
        <li key={row.key} className="list-none">
          <ul>
            <Row label={row.label} state={row.state} detail={row.detail} />
            {row.children?.map((child) => (
              <Row
                key={child.key}
                label={child.label}
                state={child.state}
                detail={child.detail}
                nested
              />
            ))}
          </ul>
        </li>
      ))}
    </ul>
  );
}
