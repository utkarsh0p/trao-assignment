/**
 * A minimal kit that satisfies every rule in the schema. Each test clones it and breaks exactly
 * one thing, so a failure names the rule that caught it.
 */
export function makeKit(overrides = {}) {
  const kit = {
    source: {
      company: 'Acme',
      company_url: 'https://acme.example/',
      role: 'Senior Backend Engineer',
      location: 'Remote',
      jd_chars: 1420,
      researched_at: '2026-09-01T09:12:44Z',
      pages_used: ['https://acme.example/', 'https://acme.example/careers'],
      notes: [],
    },
    company_brief: {
      summary: 'Acme sells widgets to other widget makers.',
      what_they_do: 'A B2B widget marketplace.',
      sources: ['https://acme.example/'],
    },
    role: {
      title: 'Senior Backend Engineer',
      seniority: 'senior',
      responsibilities: ['Own the billing service'],
      requirements: [
        { id: 'r1', text: '5+ years with Node', kind: 'technical', priority: 'must' },
        { id: 'r2', text: 'Mentoring junior engineers', kind: 'behavioural', priority: 'nice' },
      ],
    },
    questions: [
      {
        id: 'q1',
        requirement_ids: ['r1'],
        category: 'technical',
        prompt: 'Walk through how you would shard this table.',
        answer_outline: 'Key choice, hot partitions, migration path.',
        difficulty: 2,
        origin: 'generated',
      },
      {
        id: 'q2',
        requirement_ids: ['r2'],
        category: 'behavioural',
        prompt: 'Tell me about mentoring someone.',
        answer_outline: 'Situation, what you changed, outcome.',
        difficulty: 1,
        origin: 'generated',
      },
    ],
    flashcards: [
      { id: 'f1', front: 'What is a hot partition?', back: 'A shard taking disproportionate traffic.', requirement_ids: ['r1'], origin: 'generated' },
    ],
    schedule: {
      days_available: 2,
      days: [
        { day: 1, focus: 'Core technical', question_ids: ['q1'], minutes: 60 },
        { day: 2, focus: 'Behavioural', question_ids: ['q2'], minutes: 45 },
      ],
    },
    coverage: { uncovered_requirement_ids: [], passes: 2 },
  };
  return structuredClone({ ...kit, ...overrides });
}

export function makeCase(overrides = {}) {
  return {
    id: 'case-01',
    jd: 'Senior Backend Engineer\n\nWe are looking for ...',
    company_url: 'http://localhost:8099/acme/',
    days: 5,
    ...overrides,
  };
}

/** The path of the first issue, as a dotted string — makes assertions read plainly. */
export function firstIssuePath(result) {
  return result.error.issues[0].path.join('.');
}

/** A requirement, for the pipeline functions that take requirements and questions directly. */
export function makeRequirement(id, overrides = {}) {
  return { id, text: `Requirement ${id}`, kind: 'technical', priority: 'must', ...overrides };
}

export function makeQuestion(id, overrides = {}) {
  return {
    id,
    requirement_ids: [],
    category: 'technical',
    prompt: `Question ${id}?`,
    answer_outline: 'An outline.',
    difficulty: 2,
    origin: 'generated',
    ...overrides,
  };
}

/** `n` questions, ids q1..qn; `decorate(i)` supplies the overrides for each one. */
export function makeQuestions(n, decorate = () => ({})) {
  return Array.from({ length: n }, (_, i) => makeQuestion(`q${i + 1}`, decorate(i)));
}
