import { describe, expect, it } from 'vitest';
import { KitSchema } from '../src/schema/kit.js';
import { BatchOutputSchema, CasesFileSchema } from '../src/schema/batch.js';
import { firstIssuePath, makeCase, makeKit } from './factories.js';

/** Parses a kit built from the factory with one mutation applied. */
function parseWith(mutate) {
  const kit = makeKit();
  mutate(kit);
  return KitSchema.safeParse(kit);
}

describe('KitSchema', () => {
  it('accepts a well-formed kit', () => {
    expect(KitSchema.safeParse(makeKit()).success).toBe(true);
  });

  it('rejects a fractional minutes value, pointing at the day', () => {
    const result = parseWith((kit) => {
      kit.schedule.days[1].minutes = 45.5;
    });
    expect(result.success).toBe(false);
    expect(firstIssuePath(result)).toBe('schedule.days.1.minutes');
  });

  it('rejects a schedule referencing a question that does not exist', () => {
    const result = parseWith((kit) => {
      kit.schedule.days[0].question_ids = ['q9'];
    });
    expect(result.success).toBe(false);
    expect(firstIssuePath(result)).toBe('schedule.days.0.question_ids.0');
  });

  it('rejects a question referencing a requirement that does not exist', () => {
    const result = parseWith((kit) => {
      kit.questions[0].requirement_ids = ['r9'];
    });
    expect(result.success).toBe(false);
    expect(firstIssuePath(result)).toBe('questions.0.requirement_ids.0');
  });

  it('rejects a flashcard referencing a requirement that does not exist', () => {
    const result = parseWith((kit) => {
      kit.flashcards[0].requirement_ids = ['r9'];
    });
    expect(result.success).toBe(false);
    expect(firstIssuePath(result)).toBe('flashcards.0.requirement_ids.0');
  });

  it('rejects duplicate requirement ids', () => {
    const result = parseWith((kit) => {
      kit.role.requirements[1].id = 'r1';
    });
    expect(result.success).toBe(false);
    expect(firstIssuePath(result)).toBe('role.requirements.1.id');
  });

  it('rejects duplicate question ids', () => {
    const result = parseWith((kit) => {
      kit.questions[1].id = 'q1';
      kit.schedule.days[1].question_ids = ['q1'];
    });
    expect(result.success).toBe(false);
    expect(firstIssuePath(result)).toBe('questions.1.id');
  });

  it('rejects a schedule whose length disagrees with days_available', () => {
    const result = parseWith((kit) => {
      kit.schedule.days_available = 3;
    });
    expect(result.success).toBe(false);
    expect(firstIssuePath(result)).toBe('schedule.days');
  });

  it('rejects a repeated or out-of-range day number', () => {
    const result = parseWith((kit) => {
      kit.schedule.days[1].day = 1;
    });
    expect(result.success).toBe(false);
    expect(firstIssuePath(result)).toBe('schedule.days.1.day');
  });

  it('rejects coverage naming a requirement that does not exist', () => {
    const result = parseWith((kit) => {
      kit.coverage.uncovered_requirement_ids = ['r9'];
    });
    expect(result.success).toBe(false);
    expect(firstIssuePath(result)).toBe('coverage.uncovered_requirement_ids.0');
  });

  it.each([0, 4, 2.5])('rejects difficulty %s', (difficulty) => {
    const result = parseWith((kit) => {
      kit.questions[0].difficulty = difficulty;
    });
    expect(result.success).toBe(false);
  });

  it.each([
    ['role.requirements.0.priority', (kit) => { kit.role.requirements[0].priority = 'essential'; }],
    ['role.requirements.0.kind', (kit) => { kit.role.requirements[0].kind = 'soft'; }],
    ['questions.0.category', (kit) => { kit.questions[0].category = 'trivia'; }],
    ['questions.0.origin', (kit) => { kit.questions[0].origin = 'handwritten'; }],
  ])('rejects an invalid enum at %s', (path, mutate) => {
    const result = parseWith(mutate);
    expect(result.success).toBe(false);
    expect(firstIssuePath(result)).toBe(path);
  });

  it('defaults origin to generated and notes to an empty array', () => {
    const kit = makeKit();
    delete kit.questions[0].origin;
    delete kit.flashcards[0].origin;
    delete kit.source.notes;

    const result = KitSchema.safeParse(kit);
    expect(result.success).toBe(true);
    expect(result.data.questions[0].origin).toBe('generated');
    expect(result.data.flashcards[0].origin).toBe('generated');
    expect(result.data.source.notes).toEqual([]);
  });

  it('accepts a one-day schedule holding everything', () => {
    const result = parseWith((kit) => {
      kit.schedule = {
        days_available: 1,
        days: [{ day: 1, focus: 'Everything', question_ids: ['q1', 'q2'], minutes: 120 }],
      };
    });
    expect(result.success).toBe(true);
  });

  it('accepts a company URL served from a local address', () => {
    const result = parseWith((kit) => {
      kit.source.company_url = 'http://localhost:8099/acme/';
      kit.source.pages_used = ['http://localhost:8099/acme/'];
    });
    expect(result.success).toBe(true);
  });
});

describe('batch schemas', () => {
  const okResult = { id: 'case-01', status: 'ok', kit: makeKit(), error: null };
  const failedResult = {
    id: 'case-04',
    status: 'failed',
    kit: null,
    error: { code: 'COMPANY_UNREACHABLE', message: 'Company site unreachable after 3 retries.' },
  };

  it('accepts an output envelope holding both an ok and a failed case', () => {
    const result = BatchOutputSchema.safeParse({
      version: '1.0',
      generated_at: '2026-09-01T09:12:44Z',
      kits: [okResult, failedResult],
    });
    expect(result.success).toBe(true);
  });

  it('rejects a failed result that still carries a kit', () => {
    const result = BatchOutputSchema.safeParse({
      version: '1.0',
      generated_at: '2026-09-01T09:12:44Z',
      kits: [{ ...failedResult, kit: makeKit() }],
    });
    expect(result.success).toBe(false);
  });

  it('rejects an ok result with no kit', () => {
    const result = BatchOutputSchema.safeParse({
      version: '1.0',
      generated_at: '2026-09-01T09:12:44Z',
      kits: [{ id: 'case-01', status: 'ok', kit: null, error: null }],
    });
    expect(result.success).toBe(false);
  });

  it('accepts a cases file', () => {
    expect(CasesFileSchema.safeParse([makeCase()]).success).toBe(true);
  });

  it('rejects duplicate case ids', () => {
    const result = CasesFileSchema.safeParse([makeCase(), makeCase({ days: 3 })]);
    expect(result.success).toBe(false);
    expect(firstIssuePath(result)).toBe('1.id');
  });

  it('rejects an empty cases file', () => {
    expect(CasesFileSchema.safeParse([]).success).toBe(false);
  });
});
