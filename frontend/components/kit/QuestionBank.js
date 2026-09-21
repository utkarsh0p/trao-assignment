'use client';

import { useEffect, useState } from 'react';
import EmptyState from '@/components/ui/EmptyState';
import { ChevronIcon, ListIcon } from '@/components/ui/icons';
import { cx } from '@/lib/cx';
import { CATEGORY_LABEL } from '@/components/ui/Chip';
import { QUESTION_CATEGORIES, questionsByCategory, requirementIndex } from '@/lib/kit';
import QuestionCard from './QuestionCard';
import Section from './Section';

const CATEGORY_DOT = {
  technical: 'bg-cat-technical',
  behavioural: 'bg-cat-behavioural',
  'system-design': 'bg-cat-systemdesign',
  'company-fit': 'bg-cat-companyfit',
};

export default function QuestionBank({
  kit,
  actions,
  categoryActions,
  renderQuestion,
  emptyAction,
}) {
  const groups = questionsByCategory(kit);
  const requirements = requirementIndex(kit);

  // Open everywhere by default; on a phone all but the first collapse once we
  // know the viewport, which is DESIGN.md's accordion without a hydration flash
  // that hides content from anyone without JavaScript.
  const [collapsed, setCollapsed] = useState(() => new Set());

  useEffect(() => {
    if (window.matchMedia('(min-width: 768px)').matches) return;
    setCollapsed(new Set(QUESTION_CATEGORIES.slice(1)));
  }, []);

  function toggle(category) {
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(category)) next.delete(category);
      else next.add(category);
      return next;
    });
  }

  if (kit.questions.length === 0) {
    return (
      <Section id="questions" title="Question bank" actions={actions}>
        <EmptyState
          icon={ListIcon}
          title="No questions in this kit"
          description="Every category failed to generate. Regenerating the questions is the way back."
          action={emptyAction}
        />
      </Section>
    );
  }

  return (
    <Section id="questions" title="Question bank" count={kit.questions.length} actions={actions}>
      <div className="grid gap-6 lg:grid-cols-2">
        {[...groups.entries()].map(([category, questions]) => {
          const isCollapsed = collapsed.has(category);
          return (
            <div key={category} className="flex min-w-0 flex-col gap-3">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => toggle(category)}
                  aria-expanded={!isCollapsed}
                  aria-controls={`category-${category}`}
                  className="flex min-h-11 flex-1 items-center gap-2 rounded-lg text-left"
                >
                  <span className={cx('h-2 w-2 shrink-0 rounded-full', CATEGORY_DOT[category])} />
                  <span className="text-base font-medium text-text">
                    {CATEGORY_LABEL[category] || category}
                  </span>
                  <span className="rounded-full bg-bg-subtle px-2 py-0.5 text-xs font-medium text-text-muted">
                    {questions.length}
                  </span>
                  <ChevronIcon
                    className={cx(
                      'ml-auto h-4 w-4 text-text-muted transition-transform duration-150',
                      isCollapsed && '-rotate-90',
                    )}
                  />
                </button>
                {categoryActions?.(category, questions)}
              </div>

              <div id={`category-${category}`} hidden={isCollapsed}>
                {questions.length === 0 ? (
                  <p className="rounded-xl border border-dashed border-border bg-bg-subtle px-4 py-6 text-center text-xs text-text-muted">
                    Nothing in this category.
                  </p>
                ) : renderQuestion ? (
                  renderQuestion(category, questions)
                ) : (
                  <ul className="flex flex-col gap-3">
                    {questions.map((question) => (
                      <li key={question.id}>
                        <QuestionCard question={question} requirements={requirements} />
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </Section>
  );
}
