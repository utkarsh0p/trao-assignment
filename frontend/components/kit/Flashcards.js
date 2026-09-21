'use client';

import Card, { OriginMark } from '@/components/ui/Card';
import EmptyState from '@/components/ui/EmptyState';
import { IdChip } from '@/components/ui/Chip';
import { CardsIcon } from '@/components/ui/icons';
import Section from './Section';

export function FlashcardCard({ card, actions, renderText }) {
  const text = renderText || ((_path, value) => value);

  return (
    <Card origin={card.origin} className="flex flex-col gap-3">
      <div className="flex items-start justify-between gap-3">
        <p className="min-w-0 flex-1 text-base font-medium leading-normal text-text">
          {text(`flashcards.${card.id}.front`, card.front)}
        </p>
        <span className="flex shrink-0 items-center gap-1">{actions}</span>
      </div>

      <div className="rounded-lg bg-surface-sunken p-4">
        {card.back ? (
          <p className="max-w-[68ch] whitespace-pre-wrap text-[15px] leading-relaxed text-text">
            {text(`flashcards.${card.id}.back`, card.back)}
          </p>
        ) : (
          <p className="text-[15px] text-text-muted">This card has no back yet.</p>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        {card.requirement_ids.map((id) => (
          <IdChip key={id} id={id} />
        ))}
        <span className="ml-auto">
          <OriginMark origin={card.origin} />
        </span>
      </div>
    </Card>
  );
}

export default function Flashcards({ kit, actions, renderCard, emptyAction }) {
  if (kit.flashcards.length === 0) {
    return (
      <Section id="flashcards" title="Flashcards" actions={actions}>
        <EmptyState
          icon={CardsIcon}
          title="No flashcards in this kit"
          description="The deck could not be written during the run. The reason is in the gaps at the top of this page."
          action={emptyAction}
        />
      </Section>
    );
  }

  return (
    <Section id="flashcards" title="Flashcards" count={kit.flashcards.length} actions={actions}>
      {renderCard ? (
        renderCard(kit.flashcards)
      ) : (
        <ul className="grid gap-4 lg:grid-cols-2">
          {kit.flashcards.map((card) => (
            <li key={card.id}>
              <FlashcardCard card={card} />
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}
