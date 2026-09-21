import { describe, expect, it } from 'vitest';
import { generateKit, companyNameFromUrl, skipResearch } from '../src/pipeline/generateKit.js';
import { createFakeClient, purposesOf } from '../src/llm/fake.js';
import { KitSchema } from '../src/schema/kit.js';

const JD = `Senior Backend Engineer at Acme

We are looking for an engineer with 5+ years building services in Node, experience designing
systems for scale, and a track record of mentoring junior engineers. Payments or billing domain
experience is a plus. You will own the billing service.`;

/** Retrieval that succeeded, without a crawler. Phase 5 replaces this with the real thing. */
function twoPages() {
  return async () => ({
    status: 'ok',
    links_considered: 12,
    pages: [
      { url: 'https://acme.example/', title: 'Acme', text: 'Acme sells billing infrastructure.' },
      { url: 'https://acme.example/careers', title: 'Careers', text: 'We run a take-home, then design.' },
    ],
    notes: [],
  });
}

const run = (overrides = {}) =>
  generateKit({
    jd: JD,
    company_url: 'https://acme.example/',
    days: 5,
    client: createFakeClient(),
    research: twoPages(),
    ...overrides,
  });

describe('generateKit', () => {
  it('produces a schema-valid kit from a description and a company URL', async () => {
    const kit = await run();

    expect(KitSchema.safeParse(kit).success).toBe(true);
    expect(kit.source.company_url).toBe('https://acme.example/');
    expect(kit.source.jd_chars).toBe(JD.length);
    expect(kit.role.requirements).toHaveLength(4);
    expect(kit.questions.length).toBeGreaterThan(0);
    expect(kit.flashcards.length).toBeGreaterThan(0);
    expect(kit.schedule.days).toHaveLength(5);
  });

  it('runs the six steps in order, one generation call per category', async () => {
    const client = createFakeClient();
    await run({ client });

    expect(purposesOf(client)).toEqual([
      'extract-requirements',
      'company-brief',
      'questions:technical',
      'questions:behavioural',
      'questions:system-design',
      'questions:company-fit',
      'flashcards',
    ]);
  });

  it('gives every requirement a stable id and every question a resolvable reference', async () => {
    const kit = await run();
    const ids = new Set(kit.role.requirements.map((r) => r.id));

    expect([...ids]).toEqual(['r1', 'r2', 'r3', 'r4']);
    for (const question of kit.questions) {
      expect(question.requirement_ids.length).toBeGreaterThan(0);
      for (const id of question.requirement_ids) expect(ids.has(id)).toBe(true);
    }
  });

  it('marks everything it generated as generated, so regeneration can tell them apart', async () => {
    const kit = await run();
    const origins = [...kit.questions, ...kit.flashcards].map((item) => item.origin);
    expect(new Set(origins)).toEqual(new Set(['generated']));
  });

  it('reports progress for each step without letting a broken listener stop the run', async () => {
    const seen = [];
    const kit = await run({
      onProgress: (event) => {
        seen.push(event);
        if (event.step === 'schedule') throw new Error('listener blew up');
      },
    });

    expect(KitSchema.safeParse(kit).success).toBe(true);
    const steps = new Set(seen.map((event) => event.step));
    expect(steps).toEqual(new Set(['extract', 'crawl', 'scrape', 'generate', 'coverage', 'schedule']));
  });

  it('passes what the company says about hiring into the question prompts', async () => {
    const client = createFakeClient();
    await run({ client });

    const companyFit = client.calls.find((call) => call.purpose === 'questions:company-fit');
    expect(companyFit.user).toContain('How they say they interview:');
    expect(companyFit.user).toContain('take-home');
  });
});

describe('generateKit — the coverage loop', () => {
  it('closes a gap on a second pass and records the pass count', async () => {
    // The first pass covers nothing for r3; the gap-filling call is what covers it.
    const client = createFakeClient({
      handlers: { 'questions:': () => ({ questions: [] }) },
    });
    const kit = await run({ client });

    expect(kit.coverage.passes).toBe(2);
    expect(purposesOf(client).some((purpose) => purpose.startsWith('fill-gaps:'))).toBe(true);

    // Every must-have is covered by the second pass. r4 is the "plus" requirement, which the loop
    // does not chase — leaving it uncovered is reported, not fixed.
    const musts = kit.role.requirements.filter((r) => r.priority === 'must').map((r) => r.id);
    for (const id of musts) expect(kit.coverage.uncovered_requirement_ids).not.toContain(id);
    expect(kit.coverage.uncovered_requirement_ids).toEqual(['r4']);

    const filled = kit.questions.filter((q) => q.prompt.includes('follow-up'));
    expect(filled.length).toBeGreaterThan(0);
  });

  it('stops at three passes and records what it could not cover, honestly', async () => {
    // Two gaps open after the first pass. The second closes one of them, so the loop has made
    // progress and goes again; the third still cannot cover r2. That is what the cap is for.
    const client = createFakeClient({
      neverCover: ['r2'],
      handlers: { 'questions:behavioural': () => ({ questions: [] }) },
    });
    const kit = await run({ client });

    expect(kit.coverage.passes).toBe(3);
    expect(kit.coverage.uncovered_requirement_ids).toContain('r2');
    expect(kit.source.notes.some((note) => note.includes('r2'))).toBe(true);
    expect(KitSchema.safeParse(kit).success).toBe(true);

    // The gap that could be closed was closed, on the way past.
    expect(kit.coverage.uncovered_requirement_ids).not.toContain('r3');
  });

  it('does not spend a pass when a nice-to-have is the only thing uncovered', async () => {
    // r4 is the "plus" requirement; nothing covers it, and that is not worth another call.
    const client = createFakeClient({ neverCover: ['r4'] });
    const kit = await run({ client });

    expect(kit.coverage.passes).toBe(1);
    expect(kit.coverage.uncovered_requirement_ids).toEqual(['r4']);
    expect(purposesOf(client).some((purpose) => purpose.startsWith('fill-gaps:'))).toBe(false);
  });

  it('gives up rather than looping when a pass produces nothing at all', async () => {
    const client = createFakeClient({
      neverCover: ['r2'],
      handlers: { 'fill-gaps:': () => ({ questions: [] }) },
    });
    const kit = await run({ client });

    expect(kit.coverage.passes).toBe(2);
    expect(kit.coverage.uncovered_requirement_ids).toContain('r2');
  });
});

describe('generateKit — the honest paths', () => {
  it('produces a kit from the description alone when research does not run', async () => {
    const kit = await run({ research: skipResearch });

    expect(KitSchema.safeParse(kit).success).toBe(true);
    expect(kit.source.pages_used).toEqual([]);
    expect(kit.company_brief.sources).toEqual([]);
    expect(kit.company_brief.what_they_do).toBe('');
    expect(kit.source.notes.join(' ')).toContain('job description alone');
    expect(kit.questions.length).toBeGreaterThan(0);
  });

  it('does not ask the model about a company it could not read', async () => {
    const client = createFakeClient();
    await run({ client, research: skipResearch });

    expect(purposesOf(client)).not.toContain('company-brief');
  });

  it('says so when the company publishes nothing about how it hires', async () => {
    const client = createFakeClient({
      brief: { summary: 'Acme sells widgets.', what_they_do: 'Widgets.', hiring_process: '' },
    });
    const kit = await run({ client });

    expect(kit.source.notes.some((note) => note.includes('nothing about how it interviews'))).toBe(true);
  });

  it('says a two-line description is thin instead of padding it out', async () => {
    const client = createFakeClient({
      extract: {
        title: 'Backend Engineer',
        seniority: '',
        location: '',
        responsibilities: [],
        requirements: [{ text: 'Node', kind: 'technical', priority: 'must' }],
      },
    });
    const kit = await run({ jd: 'Backend Engineer.\nMust know Node.', client });

    expect(kit.role.requirements).toHaveLength(1);
    expect(kit.source.notes.some((note) => note.includes('short'))).toBe(true);
    expect(KitSchema.safeParse(kit).success).toBe(true);
  });

  it('still produces a valid kit when the description yields no requirements at all', async () => {
    const client = createFakeClient({
      extract: { title: '', seniority: '', location: '', responsibilities: [], requirements: [] },
    });
    const kit = await run({ jd: 'Job.', client, days: 3 });

    expect(KitSchema.safeParse(kit).success).toBe(true);
    expect(kit.questions).toEqual([]);
    expect(kit.flashcards).toEqual([]);
    expect(kit.schedule.days).toHaveLength(3);
    expect(kit.source.notes.some((note) => note.includes('No requirements'))).toBe(true);
  });

  it('drops a question the model tied to a requirement that does not exist', async () => {
    const client = createFakeClient({
      handlers: {
        'questions:technical': () => ({
          questions: [
            { requirement_ids: ['r99'], prompt: 'Invented.', answer_outline: '', difficulty: 2 },
            { requirement_ids: ['r1'], prompt: 'Real.', answer_outline: '', difficulty: 2 },
          ],
        }),
      },
    });
    const kit = await run({ client });

    expect(kit.questions.some((q) => q.prompt === 'Invented.')).toBe(false);
    expect(kit.questions.some((q) => q.prompt === 'Real.')).toBe(true);
  });

  it('lets a failure in the first step surface rather than saving half a kit', async () => {
    const client = createFakeClient({
      fail: (call) => (call.purpose === 'extract-requirements' ? new Error('model down') : undefined),
    });

    await expect(run({ client })).rejects.toThrow('model down');
  });
});

describe('companyNameFromUrl', () => {
  it('reads a usable name out of the host', () => {
    expect(companyNameFromUrl('https://www.acme-labs.example/careers')).toBe('Acme Labs');
    expect(companyNameFromUrl('http://localhost:8099/acme/')).toBe('Localhost');
    expect(companyNameFromUrl('not a url')).toBe('');
  });
});
