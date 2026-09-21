'use client';

import Card from '@/components/ui/Card';
import { CategoryChip } from '@/components/ui/Chip';
import { formatMinutes, questionIndex } from '@/lib/kit';
import Section from './Section';

export default function Schedule({ kit, actions, renderDayFields }) {
  const questions = questionIndex(kit);
  const { days, days_available: total } = kit.schedule;

  return (
    <Section
      id="schedule"
      title="Study schedule"
      count={total === 1 ? '1 day' : `${total} days`}
      actions={actions}
      description="Harder and higher-priority material sits earlier, and a day is never longer than three hours."
    >
      {/* Stacked on a phone, a horizontal strip from md up. */}
      <ul className="flex flex-col gap-4 md:flex-row md:snap-x md:overflow-x-auto md:pb-2">
        {days.map((day) => (
          <li key={day.day} className="md:w-80 md:shrink-0 md:snap-start">
            <Card className="flex h-full flex-col gap-3">
              <div className="flex items-baseline justify-between gap-3">
                <p className="text-base font-medium text-text">Day {day.day}</p>
                <span className="text-xs text-text-muted">{formatMinutes(day.minutes)}</span>
              </div>

              <p className="text-[15px] leading-relaxed text-text-muted">
                {renderDayFields ? renderDayFields(day, 'focus') : day.focus}
              </p>

              {day.question_ids.length ? (
                <ol className="flex flex-col gap-2">
                  {day.question_ids.map((id) => {
                    const question = questions.get(id);
                    if (!question) return null;
                    return (
                      <li key={id} className="flex flex-col gap-1 border-t border-border pt-2">
                        <CategoryChip category={question.category} className="self-start" />
                        <span className="text-[15px] leading-relaxed text-text">
                          {question.prompt}
                        </span>
                      </li>
                    );
                  })}
                </ol>
              ) : (
                <p className="text-xs text-text-muted">
                  Nothing scheduled — a rest day, or one you have cleared.
                </p>
              )}

              {renderDayFields ? renderDayFields(day, 'actions') : null}
            </Card>
          </li>
        ))}
      </ul>
    </Section>
  );
}
