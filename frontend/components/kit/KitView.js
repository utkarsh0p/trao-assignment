'use client';

import Badge from '@/components/ui/Badge';
import Notice from '@/components/ui/Notice';
import { BuildingIcon, CalendarIcon, CardsIcon, DocumentIcon, ListIcon } from '@/components/ui/icons';
import Brief from './Brief';
import CoverageBanner from './CoverageBanner';
import Flashcards from './Flashcards';
import Notes from './Notes';
import QuestionBank from './QuestionBank';
import Role from './Role';
import Schedule from './Schedule';

const SECTIONS = [
  { id: 'brief', label: 'Company brief', icon: BuildingIcon },
  { id: 'role', label: 'The role', icon: DocumentIcon },
  { id: 'questions', label: 'Question bank', icon: ListIcon },
  { id: 'flashcards', label: 'Flashcards', icon: CardsIcon },
  { id: 'schedule', label: 'Schedule', icon: CalendarIcon },
];

function Nav() {
  return (
    <nav aria-label="Sections" className="lg:sticky lg:top-24">
      <ul className="flex flex-wrap gap-1 lg:flex-col">
        {SECTIONS.map(({ id, label, icon: Icon }) => (
          <li key={id}>
            <a
              href={`#${id}`}
              className="flex min-h-11 items-center gap-2 rounded-lg px-3 text-xs font-medium text-text-muted transition-colors duration-150 hover:bg-bg-subtle hover:text-text"
            >
              <Icon className="h-4 w-4" />
              {label}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}

/**
 * The read-only kit. Every editing affordance is injected by the builder
 * (components/kit/KitBuilder.js) through these same components, so the two
 * never drift apart.
 */
export default function KitView({ record, slots = {} }) {
  const { kit } = record;
  const busy = record.status === 'regenerating' || record.status === 'running';

  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-col gap-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <h1 className="text-3xl font-semibold leading-tight text-text">
              {kit.role.title || 'Untitled role'}
            </h1>
            <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[15px] text-text-muted">
              <span>{kit.source.company || new URL(kit.source.company_url).hostname}</span>
              {kit.source.location ? <span>· {kit.source.location}</span> : null}
              <span>
                ·{' '}
                {kit.schedule.days_available === 1
                  ? '1 day to prepare'
                  : `${kit.schedule.days_available} days to prepare`}
              </span>
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge status={record.status} />
            {slots.headerActions}
          </div>
        </div>
      </header>

      {/* A ready kit carrying an error means the last regeneration failed and
          this kit is untouched. It is the one place that combination arises. */}
      {record.status === 'ready' && record.error ? (
        <Notice tone="warn" title="The last regeneration did not work">
          {record.error.message} Nothing on this page changed.
        </Notice>
      ) : null}

      {busy ? (
        <Notice tone="info" title="Working on this kit">
          The version below is the one you already had. It is replaced only when the new one is
          ready.
        </Notice>
      ) : null}

      <Notes notes={kit.source.notes} />
      <CoverageBanner kit={kit} />

      <div className="grid gap-8 lg:grid-cols-[12rem_1fr]">
        <Nav />

        <div className="flex min-w-0 flex-col gap-12">
          <Brief kit={kit} actions={slots.briefActions} renderField={slots.renderField} />
          <Role kit={kit} actions={slots.roleActions} renderField={slots.renderField} />
          <QuestionBank
            kit={kit}
            actions={slots.questionActions}
            categoryActions={slots.categoryActions}
            renderQuestion={slots.renderQuestion}
            emptyAction={slots.questionsEmptyAction}
          />
          <Flashcards
            kit={kit}
            actions={slots.flashcardActions}
            renderCard={slots.renderFlashcards}
            emptyAction={slots.flashcardsEmptyAction}
          />
          <Schedule
            kit={kit}
            actions={slots.scheduleActions}
            renderDayFields={slots.renderDayFields}
          />
        </div>
      </div>
    </div>
  );
}
