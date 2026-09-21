'use client';

import Card from '@/components/ui/Card';
import { IdChip, PriorityChip } from '@/components/ui/Chip';
import { CheckIcon, AlertIcon } from '@/components/ui/icons';
import { isCovered } from '@/lib/kit';
import Section from './Section';

/** Coverage carries an icon as well as a colour — never colour alone. */
function CoverageMark({ covered, priority }) {
  if (covered) {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-success">
        <CheckIcon className="h-3 w-3" />
        Covered
      </span>
    );
  }
  const tone = priority === 'must' ? 'text-danger' : 'text-text-muted';
  return (
    <span className={`inline-flex items-center gap-1 text-xs ${tone}`}>
      <AlertIcon className="h-3 w-3" />
      No question
    </span>
  );
}

export default function Role({ kit, actions, renderField, renderRequirementExtras }) {
  const { role } = kit;
  const field = renderField || ((_path, value) => value);

  return (
    <Section id="role" title="The role" actions={actions}>
      <div className="flex flex-col gap-4">
        <Card className="flex flex-col gap-6">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <p className="text-base font-medium text-text">{field('role.title', role.title)}</p>
            {role.seniority ? (
              <span className="text-xs text-text-muted">
                {field('role.seniority', role.seniority)}
              </span>
            ) : null}
          </div>

          <div>
            <p className="text-xs font-medium text-text-muted">Responsibilities</p>
            {role.responsibilities.length ? (
              <ul className="mt-2 flex max-w-[68ch] list-disc flex-col gap-1.5 pl-4 text-[15px] leading-relaxed text-text">
                {role.responsibilities.map((item, index) => (
                  <li key={index}>{item}</li>
                ))}
              </ul>
            ) : (
              <p className="mt-1 text-[15px] text-text-muted">
                The posting did not list any, so none are claimed here.
              </p>
            )}
          </div>
        </Card>

        <Card>
          <p className="text-xs font-medium text-text-muted">
            Requirements ({role.requirements.length})
          </p>
          <ul className="mt-3 divide-y divide-border">
            {role.requirements.map((requirement) => (
              <li
                key={requirement.id}
                className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2 py-3 first:pt-0 last:pb-0"
              >
                <div className="flex min-w-0 flex-1 items-start gap-2">
                  <IdChip id={requirement.id} className="mt-0.5" />
                  <span className="min-w-0 flex-1 text-[15px] leading-relaxed text-text">
                    {requirement.text}
                  </span>
                </div>
                <div className="flex shrink-0 items-center gap-3">
                  <PriorityChip priority={requirement.priority} />
                  <CoverageMark
                    covered={isCovered(kit, requirement.id)}
                    priority={requirement.priority}
                  />
                  {renderRequirementExtras?.(requirement)}
                </div>
              </li>
            ))}
          </ul>
          {role.requirements.length === 0 ? (
            <p className="mt-2 text-[15px] text-text-muted">
              Nothing could be extracted from the posting.
            </p>
          ) : null}
        </Card>
      </div>
    </Section>
  );
}
