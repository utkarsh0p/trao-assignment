'use client';

import { useState } from 'react';
import Button from '@/components/ui/Button';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import Modal from '@/components/ui/Modal';
import { Textarea } from '@/components/ui/Field';
import { PlusIcon, TrashIcon } from '@/components/ui/icons';
import { CATEGORY_LABEL } from '@/components/ui/Chip';
import { QUESTION_CATEGORIES, requirementIndex } from '@/lib/kit';
import {
  useAddFlashcard,
  useAddQuestion,
  useDeleteFlashcard,
  useDeleteQuestion,
  useEditBrief,
  useEditFlashcard,
  useEditQuestion,
  useEditRole,
  useEditScheduleDay,
  useReorderFlashcards,
  useReorderQuestions,
} from '@/lib/mutations';
import { AddFlashcardModal, AddQuestionModal } from './AddForms';
import { FlashcardCard } from './Flashcards';
import InlineEdit from './InlineEdit';
import KitView from './KitView';
import QuestionCard from './QuestionCard';
import RegenerateButton from './Regenerate';
import SortableList from './SortableList';

/** Delete is danger, and always behind a confirmation. */
function DeleteButton({ label, description, onConfirm, pending }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="ghost" size="sm" aria-label={`Delete ${label}`} onClick={() => setOpen(true)}>
        <TrashIcon className="h-3.5 w-3.5" />
      </Button>
      <ConfirmDialog
        open={open}
        onClose={() => setOpen(false)}
        onConfirm={() => {
          onConfirm();
          setOpen(false);
        }}
        title={`Delete this ${label}?`}
        description={description}
        confirmLabel="Delete"
        tone="danger"
        loading={pending}
      />
    </>
  );
}

function ResponsibilitiesModal({ open, onClose, responsibilities, onSave, pending }) {
  const [text, setText] = useState(responsibilities.join('\n'));

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Edit responsibilities"
      description="One per line."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            loading={pending}
            onClick={() => {
              onSave(
                text
                  .split('\n')
                  .map((line) => line.trim())
                  .filter(Boolean),
              );
              onClose();
            }}
          >
            Save
          </Button>
        </>
      }
    >
      <Textarea
        label="Responsibilities"
        rows={10}
        value={text}
        onChange={(event) => setText(event.target.value)}
      />
    </Modal>
  );
}

/**
 * The editable kit. It renders the same components as the read-only view and
 * passes editing affordances in through its slots, so the two can never drift.
 */
export default function KitBuilder({ record }) {
  const kitId = record.id;
  const { kit } = record;
  const requirements = requirementIndex(kit);
  const busy = record.status === 'regenerating' || record.status === 'running';

  const editBrief = useEditBrief(kitId);
  const editRole = useEditRole(kitId);
  const editQuestion = useEditQuestion(kitId);
  const addQuestion = useAddQuestion(kitId);
  const deleteQuestion = useDeleteQuestion(kitId);
  const reorderQuestions = useReorderQuestions(kitId);
  const editFlashcard = useEditFlashcard(kitId);
  const addFlashcard = useAddFlashcard(kitId);
  const deleteFlashcard = useDeleteFlashcard(kitId);
  const reorderFlashcards = useReorderFlashcards(kitId);
  const editDay = useEditScheduleDay(kitId);

  const [addingQuestion, setAddingQuestion] = useState(null); // category | null
  const [addingFlashcard, setAddingFlashcard] = useState(false);
  const [editingResponsibilities, setEditingResponsibilities] = useState(false);

  /** Inline editing for the plain-text fields of the brief and the role. */
  function renderField(path, value) {
    const [group, field] = path.split('.');
    const multiline = field === 'summary' || field === 'what_they_do';
    const save = (next) =>
      group === 'company_brief'
        ? editBrief.mutate({ [field]: next })
        : editRole.mutate({ [field]: next });

    return (
      <InlineEdit
        value={value}
        label={field.replace(/_/g, ' ')}
        multiline={multiline}
        rows={multiline ? 5 : undefined}
        maxLength={multiline ? 4000 : 200}
        onSave={save}
      />
    );
  }

  function renderQuestionText(path, value) {
    const [, id, field] = path.split('.');
    return (
      <InlineEdit
        value={value}
        label={field === 'prompt' ? 'question' : 'answer outline'}
        multiline
        rows={field === 'prompt' ? 3 : 6}
        maxLength={field === 'prompt' ? 2000 : 6000}
        onSave={(next) => editQuestion.mutate({ id, [field]: next })}
      />
    );
  }

  function renderFlashcardText(path, value) {
    const [, id, field] = path.split('.');
    return (
      <InlineEdit
        value={value}
        label={field}
        multiline={field === 'back'}
        rows={4}
        maxLength={field === 'front' ? 1000 : 4000}
        onSave={(next) => editFlashcard.mutate({ id, [field]: next })}
      />
    );
  }

  /** There is no move-between-categories endpoint — moving is a category patch. */
  function CategorySelect({ question }) {
    return (
      <>
        <label className="sr-only" htmlFor={`category-of-${question.id}`}>
          Category of this question
        </label>
        <select
          id={`category-of-${question.id}`}
          value={question.category}
          onChange={(event) => editQuestion.mutate({ id: question.id, category: event.target.value })}
          className="h-11 rounded-lg border border-border bg-surface px-2 text-xs text-text-muted transition-colors duration-150 hover:border-border-strong md:h-9"
        >
          {QUESTION_CATEGORIES.map((value) => (
            <option key={value} value={value}>
              {CATEGORY_LABEL[value]}
            </option>
          ))}
        </select>
      </>
    );
  }

  const slots = {
    headerActions: null,

    renderField,

    briefActions: <RegenerateButton kit={kit} kitId={kitId} section="brief" disabled={busy} />,

    roleActions: (
      <Button variant="secondary" size="sm" onClick={() => setEditingResponsibilities(true)}>
        Edit responsibilities
      </Button>
    ),

    questionActions: (
      <>
        <Button variant="primary" size="sm" onClick={() => setAddingQuestion('technical')}>
          <PlusIcon className="h-3.5 w-3.5" />
          Add question
        </Button>
        <RegenerateButton
          kit={kit}
          kitId={kitId}
          section="questions"
          disabled={busy}
          label="Regenerate all"
        />
      </>
    ),

    questionsEmptyAction: (
      <RegenerateButton
        kit={kit}
        kitId={kitId}
        section="questions"
        disabled={busy}
        size="md"
        label="Regenerate questions"
      />
    ),

    categoryActions: (category) => (
      <div className="flex items-center gap-1">
        <Button
          variant="ghost"
          size="sm"
          aria-label={`Add a ${CATEGORY_LABEL[category].toLowerCase()} question`}
          onClick={() => setAddingQuestion(category)}
        >
          <PlusIcon className="h-3.5 w-3.5" />
        </Button>
        <RegenerateButton
          kit={kit}
          kitId={kitId}
          section="questions"
          category={category}
          disabled={busy}
        />
      </div>
    ),

    renderQuestion: (category, questions) => (
      <SortableList
        items={questions}
        label="question"
        className="flex flex-col gap-3"
        onReorder={(ids) => reorderQuestions.mutate(ids)}
      >
        {(question, { dragging, handle }) => (
          <QuestionCard
            question={question}
            requirements={requirements}
            dragging={dragging}
            handle={handle}
            renderText={renderQuestionText}
            actions={
              <>
                <CategorySelect question={question} />
                <DeleteButton
                  label="question"
                  description="It comes off its study day as well. This cannot be undone."
                  pending={deleteQuestion.isPending}
                  onConfirm={() => deleteQuestion.mutate(question.id)}
                />
              </>
            }
          />
        )}
      </SortableList>
    ),

    flashcardActions: (
      <>
        <Button variant="secondary" size="sm" onClick={() => setAddingFlashcard(true)}>
          <PlusIcon className="h-3.5 w-3.5" />
          Add card
        </Button>
        <RegenerateButton kit={kit} kitId={kitId} section="flashcards" disabled={busy} />
      </>
    ),

    flashcardsEmptyAction: (
      <div className="flex flex-wrap justify-center gap-2">
        <Button variant="primary" onClick={() => setAddingFlashcard(true)}>
          <PlusIcon className="h-4 w-4" />
          Write one
        </Button>
        <RegenerateButton
          kit={kit}
          kitId={kitId}
          section="flashcards"
          disabled={busy}
          size="md"
          label="Try generating again"
        />
      </div>
    ),

    renderFlashcards: (cards) => (
      <SortableList
        items={cards}
        label="flashcard"
        className="grid gap-4 lg:grid-cols-2"
        onReorder={(ids) => reorderFlashcards.mutate(ids)}
      >
        {(card, { handle }) => (
          <FlashcardCard
            card={card}
            renderText={renderFlashcardText}
            actions={
              <>
                {handle}
                <DeleteButton
                  label="flashcard"
                  description="This cannot be undone."
                  pending={deleteFlashcard.isPending}
                  onConfirm={() => deleteFlashcard.mutate(card.id)}
                />
              </>
            }
          />
        )}
      </SortableList>
    ),

    scheduleActions: (
      <RegenerateButton
        kit={kit}
        kitId={kitId}
        section="schedule"
        disabled={busy}
        label="Rebuild schedule"
      />
    ),

    renderDayFields: (day, slot) => {
      if (slot === 'focus') {
        return (
          <InlineEdit
            value={day.focus}
            label={`focus for day ${day.day}`}
            maxLength={200}
            onSave={(next) => editDay.mutate({ day: day.day, focus: next })}
          />
        );
      }
      return (
        <div className="mt-auto flex items-center gap-2 border-t border-border pt-3 text-xs text-text-muted">
          <label htmlFor={`minutes-day-${day.day}`}>Minutes</label>
          <input
            id={`minutes-day-${day.day}`}
            type="number"
            min={0}
            max={1440}
            step={1}
            defaultValue={day.minutes}
            key={day.minutes}
            onBlur={(event) => {
              const minutes = Number(event.target.value);
              if (Number.isInteger(minutes) && minutes !== day.minutes) {
                editDay.mutate({ day: day.day, minutes });
              }
            }}
            className="h-11 w-20 rounded-lg border border-border bg-surface px-2 text-xs text-text md:h-9"
          />
        </div>
      );
    },
  };

  return (
    <>
      <KitView record={record} slots={slots} />

      <AddQuestionModal
        open={addingQuestion !== null}
        defaultCategory={addingQuestion || 'technical'}
        onClose={() => setAddingQuestion(null)}
        kit={kit}
        pending={addQuestion.isPending}
        onSubmit={(body, done) => addQuestion.mutate(body, { onSuccess: done })}
      />

      <AddFlashcardModal
        open={addingFlashcard}
        onClose={() => setAddingFlashcard(false)}
        kit={kit}
        pending={addFlashcard.isPending}
        onSubmit={(body, done) => addFlashcard.mutate(body, { onSuccess: done })}
      />

      <ResponsibilitiesModal
        key={kit.role.responsibilities.join('|')}
        open={editingResponsibilities}
        onClose={() => setEditingResponsibilities(false)}
        responsibilities={kit.role.responsibilities}
        pending={editRole.isPending}
        onSave={(responsibilities) => editRole.mutate({ responsibilities })}
      />
    </>
  );
}
