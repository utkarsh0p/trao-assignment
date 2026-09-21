'use client';

import Notice from '@/components/ui/Notice';
import { IdChip } from '@/components/ui/Chip';
import { coverageGaps } from '@/lib/kit';

function Gaps({ requirements }) {
  return (
    <ul className="mt-2 flex flex-col gap-1.5">
      {requirements.map((requirement) => (
        <li key={requirement.id} className="flex items-start gap-2">
          <IdChip id={requirement.id} className="mt-0.5" />
          <span className="min-w-0 flex-1">{requirement.text}</span>
        </li>
      ))}
    </ul>
  );
}

/**
 * A kit that ships with uncovered must-haves has failed at the one job it had,
 * so that case is danger-toned and never collapsed away. An uncovered
 * nice-to-have is reported plainly and costs nothing.
 */
export default function CoverageBanner({ kit }) {
  const { must, nice } = coverageGaps(kit);

  if (must.length === 0 && nice.length === 0) {
    return (
      <Notice tone="success" title="Every requirement has a question against it">
        {kit.coverage.passes > 0
          ? `Reached after ${kit.coverage.passes === 1 ? 'one pass' : `${kit.coverage.passes} passes`}.`
          : null}
      </Notice>
    );
  }

  if (must.length > 0) {
    return (
      <Notice
        tone="danger"
        title={
          must.length === 1
            ? 'One must-have requirement has no question'
            : `${must.length} must-have requirements have no question`
        }
      >
        <p>Regenerating that category is the fastest way to close the gap.</p>
        <Gaps requirements={must} />
        {nice.length > 0 ? (
          <p className="mt-3 text-text-muted">
            {nice.length === 1 ? 'One nice-to-have is' : `${nice.length} nice-to-haves are`} also
            uncovered.
          </p>
        ) : null}
      </Notice>
    );
  }

  return (
    <Notice
      tone="info"
      title={
        nice.length === 1
          ? 'One nice-to-have has no question'
          : `${nice.length} nice-to-haves have no question`
      }
    >
      <p className="text-text-muted">Every must-have is covered.</p>
      <Gaps requirements={nice} />
    </Notice>
  );
}
