'use client';

import { cx } from '@/lib/cx';

const CATEGORY_STYLE = {
  technical: 'bg-cat-technical-subtle text-cat-technical',
  behavioural: 'bg-cat-behavioural-subtle text-cat-behavioural',
  'system-design': 'bg-cat-systemdesign-subtle text-cat-systemdesign',
  'company-fit': 'bg-cat-companyfit-subtle text-cat-companyfit',
};

export const CATEGORY_LABEL = {
  technical: 'Technical',
  behavioural: 'Behavioural',
  'system-design': 'System design',
  'company-fit': 'Company fit',
};

const BASE = 'inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium';

/** Carries its own text — colour is never the only thing saying what this is. */
export function CategoryChip({ category, className }) {
  return (
    <span className={cx(BASE, CATEGORY_STYLE[category] || 'bg-bg-subtle text-text-muted', className)}>
      {CATEGORY_LABEL[category] || category}
    </span>
  );
}

export function PriorityChip({ priority, className }) {
  const must = priority === 'must';
  return (
    <span
      className={cx(
        BASE,
        must ? 'bg-danger-subtle text-danger' : 'bg-bg-subtle text-text-muted',
        className,
      )}
    >
      {must ? 'Must have' : 'Nice to have'}
    </span>
  );
}

function Dots({ value, max = 3, filled, label }) {
  return (
    <span className="inline-flex items-center gap-1.5" title={label}>
      <span className="sr-only">{label}</span>
      <span className="flex items-center gap-0.5" aria-hidden="true">
        {Array.from({ length: max }, (_, i) => (
          <span
            key={i}
            className={cx(
              'h-1.5 w-1.5 rounded-full',
              i < value ? filled : 'bg-border-strong',
            )}
          />
        ))}
      </span>
    </span>
  );
}

export function DifficultyChip({ difficulty }) {
  return (
    <Dots
      value={difficulty}
      filled="bg-accent"
      label={`Difficulty ${difficulty} of 3`}
    />
  );
}

export function ConfidenceChip({ confidence }) {
  const filled =
    confidence === 1 ? 'bg-danger' : confidence === 2 ? 'bg-warn' : 'bg-success';
  return (
    <Dots value={confidence} filled={filled} label={`Confidence ${confidence} of 3`} />
  );
}

/** A requirement id, wherever one is shown. */
export function IdChip({ id, className }) {
  return (
    <span
      className={cx(
        'inline-flex items-center rounded-full bg-bg-subtle px-2 py-0.5 font-mono text-xs text-text-muted',
        className,
      )}
    >
      {id}
    </span>
  );
}
