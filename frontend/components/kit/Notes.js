'use client';

import Notice from '@/components/ui/Notice';

/**
 * Where every honest gap in the kit lives: an unreachable site, a posting too
 * thin to say much about, a deck that could not be written. RULES.md makes
 * surfacing these the point rather than a footnote, so they sit at the top.
 */
export default function Notes({ notes }) {
  if (!notes?.length) return null;

  return (
    <Notice tone="warn" title={notes.length === 1 ? 'One gap in this kit' : `${notes.length} gaps in this kit`}>
      <ul className="flex list-disc flex-col gap-1 pl-4">
        {notes.map((note, index) => (
          <li key={index}>{note}</li>
        ))}
      </ul>
    </Notice>
  );
}
