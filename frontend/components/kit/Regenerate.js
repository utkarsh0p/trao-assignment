'use client';

import { useState } from 'react';
import Button from '@/components/ui/Button';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import { RefreshIcon } from '@/components/ui/icons';
import { CATEGORY_LABEL } from '@/components/ui/Chip';
import { originCounts } from '@/lib/kit';
import { useRegenerate } from '@/lib/mutations';

const count = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

/**
 * Before anything is replaced the user is told exactly what goes and what
 * stays. The counts come from `origin` on the kit in front of them, which is
 * the same field the server uses to decide — so the sentence is a fact, not a
 * promise.
 */
function describe(kit, section, category) {
  if (section === 'brief') {
    return {
      title: 'Regenerate the company brief?',
      description:
        'The company site is read again and the summary, what they do, and how they hire are all rewritten. The notes about what could and could not be read are replaced by notes about the new run.',
    };
  }

  if (section === 'schedule') {
    const handEdited = kit.schedule.days.length;
    return {
      title: 'Rebuild the study schedule?',
      description: `All ${count(handEdited, 'day')} are laid out again from the current question bank. Any day you arranged by hand goes back to the automatic order. Questions themselves are untouched.`,
    };
  }

  if (section === 'flashcards') {
    const { generated, edited, pinned } = originCounts(kit.flashcards);
    const kept = edited + pinned;
    return {
      title: 'Regenerate the flashcards?',
      description: `${count(generated, 'generated card')} will be replaced.${
        kept ? ` ${count(kept, 'card')} you wrote or edited will be kept.` : ''
      }`,
    };
  }

  const scope = category
    ? kit.questions.filter((question) => question.category === category)
    : kit.questions;
  const { generated, edited, pinned } = originCounts(scope);
  const kept = edited + pinned;
  const where = category ? `${CATEGORY_LABEL[category]} questions` : 'questions in every category';

  return {
    title: category
      ? `Regenerate the ${CATEGORY_LABEL[category].toLowerCase()} questions?`
      : 'Regenerate every question?',
    description: `${count(generated, 'generated question')} in ${where} will be replaced.${
      kept ? ` ${count(kept, 'question')} you wrote or edited will be kept.` : ''
    }`,
  };
}

export default function RegenerateButton({
  kit,
  kitId,
  section,
  category,
  disabled,
  size = 'sm',
  label,
}) {
  const [open, setOpen] = useState(false);
  const regenerate = useRegenerate(kitId);
  const { title, description } = describe(kit, section, category);

  return (
    <>
      {/* Regenerate is always secondary — the one primary action per view is elsewhere. */}
      <Button
        variant="secondary"
        size={size}
        disabled={disabled}
        onClick={() => setOpen(true)}
      >
        <RefreshIcon className="h-3.5 w-3.5" />
        {label || 'Regenerate'}
      </Button>

      <ConfirmDialog
        open={open}
        onClose={() => setOpen(false)}
        onConfirm={() => {
          regenerate.mutate({ section, category });
          setOpen(false);
        }}
        title={title}
        description={description}
        confirmLabel="Regenerate"
        tone="primary"
        loading={regenerate.isPending}
      />
    </>
  );
}
