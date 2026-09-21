'use client';

import { useState } from 'react';
import Card, { OriginMark } from '@/components/ui/Card';
import { CategoryChip, DifficultyChip, IdChip } from '@/components/ui/Chip';
import { ChevronIcon } from '@/components/ui/icons';
import { cx } from '@/lib/cx';

export default function QuestionCard({
  question,
  requirements,
  actions,
  handle,
  renderText,
  className,
  style,
  innerRef,
  dragging = false,
  ...rest
}) {
  const [open, setOpen] = useState(false);
  const text = renderText || ((_path, value) => value);

  return (
    <Card
      ref={innerRef}
      origin={question.origin}
      interactive
      style={style}
      className={cx(
        'flex flex-col gap-3',
        dragging && 'border-border-strong shadow-lg',
        className,
      )}
      {...rest}
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        {handle}
        <CategoryChip category={question.category} />
        <DifficultyChip difficulty={question.difficulty} />
        <OriginMark origin={question.origin} />
        <span className="ml-auto flex items-center gap-1">{actions}</span>
      </div>

      <p className="text-base font-medium leading-normal text-text">
        {text(`questions.${question.id}.prompt`, question.prompt)}
      </p>

      {question.requirement_ids.length ? (
        <div className="flex flex-wrap items-center gap-1.5">
          {question.requirement_ids.map((id) => (
            <IdChip key={id} id={id} />
          ))}
          <span className="sr-only">
            covers {question.requirement_ids.map((id) => requirements?.get(id)?.text).join('; ')}
          </span>
        </div>
      ) : (
        <p className="text-xs text-text-muted">Covers no requirement.</p>
      )}

      <div>
        <button
          type="button"
          onClick={() => setOpen((current) => !current)}
          aria-expanded={open}
          className="inline-flex items-center gap-1 rounded-lg text-xs font-medium text-accent transition-colors duration-150 hover:text-accent-hover"
        >
          <ChevronIcon className={cx('h-3.5 w-3.5 transition-transform duration-150', open && 'rotate-180')} />
          {open ? 'Hide answer outline' : 'Show answer outline'}
        </button>

        {open ? (
          <div className="mt-2 rounded-lg bg-surface-sunken p-4">
            {question.answer_outline ? (
              <p className="max-w-[68ch] whitespace-pre-wrap text-[15px] leading-relaxed text-text">
                {text(`questions.${question.id}.answer_outline`, question.answer_outline)}
              </p>
            ) : (
              <p className="text-[15px] text-text-muted">No outline was written for this one.</p>
            )}
          </div>
        ) : null}
      </div>
    </Card>
  );
}
