import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

import { DEFAULT_CONCURRENCY, readCases, runBatch } from '../scripts/evaluate.js';
import { startFixtures } from '../scripts/serve-fixtures.js';
import { createFakeClient } from '../src/llm/fake.js';
import { LlmOutputError } from '../src/llm/index.js';
import { createResearch } from '../src/pipeline/crawl.js';
import { BatchOutputSchema } from '../src/schema/batch.js';
import { makeCase } from './factories.js';

const run = promisify(execFile);
const BACKEND = path.resolve(fileURLToPath(new URL('..', import.meta.url)));

let fixtures;
let workdir;

beforeAll(async () => {
  fixtures = await startFixtures({ port: 0 });
  workdir = await fs.mkdtemp(path.join(os.tmpdir(), 'prepkit-batch-'));
});

afterAll(async () => {
  await fixtures.close();
  await fs.rm(workdir, { recursive: true, force: true });
});

const casesFor = (sites) =>
  sites.map((site, index) =>
    makeCase({
      id: `case-0${index + 1}`,
      jd: 'Backend engineer. 5+ years Node, systems at scale, mentoring juniors. Billing a plus.',
      company_url: `${fixtures.baseUrl}/${site}/`,
      days: 3,
    }),
  );

const batch = (overrides = {}) =>
  runBatch({
    cases: casesFor(['acme', 'northwind']),
    client: createFakeClient(),
    research: createResearch({ allowPrivateUrls: true }),
    ...overrides,
  });

describe('runBatch', () => {
  it('writes one entry per case, in the order they were given', async () => {
    const output = await batch({ cases: casesFor(['acme', 'northwind', 'borealis']) });

    expect(BatchOutputSchema.safeParse(output).success).toBe(true);
    expect(output.version).toBe('1.0');
    expect(output.kits.map((result) => result.id)).toEqual(['case-01', 'case-02', 'case-03']);
    for (const result of output.kits) {
      expect(result.status).toBe('ok');
      expect(result.error).toBeNull();
    }
  });

  it('records a failure for one case without touching the others', async () => {
    const good = createFakeClient();
    const client = {
      ...good,
      json: (call) => {
        if (call.purpose === 'extract-requirements' && call.user.includes('POISON')) {
          throw new Error('extraction failed');
        }
        return good.json(call);
      },
    };

    const output = await runBatch({
      cases: [
        makeCase({ id: 'fine', jd: 'Node engineer, 5 years.', company_url: `${fixtures.baseUrl}/acme/`, days: 2 }),
        makeCase({ id: 'broken', jd: 'POISON', company_url: `${fixtures.baseUrl}/acme/`, days: 2 }),
      ],
      client,
      research: createResearch({ allowPrivateUrls: true }),
    });

    expect(output.kits[0].status).toBe('ok');
    expect(output.kits[0].kit.questions.length).toBeGreaterThan(0);

    expect(output.kits[1].status).toBe('failed');
    expect(output.kits[1].kit).toBeNull();
    expect(output.kits[1].error.code).toBe('UNEXPECTED_ERROR');
    expect(output.kits[1].error.message).toContain('extraction failed');
  });

  it('degrades a section the model will not produce, rather than losing the kit', async () => {
    const good = createFakeClient();
    const client = {
      ...good,
      json: (call) => {
        if (call.purpose.startsWith('questions:behavioural')) {
          throw new LlmOutputError('questions:behavioural: reply was not JSON.', { raw: 'sorry' });
        }
        return good.json(call);
      },
    };

    const output = await runBatch({
      cases: casesFor(['acme']),
      client,
      research: createResearch({ allowPrivateUrls: true }),
    });

    // The kit survives, and the failure is recorded rather than hidden.
    const [result] = output.kits;
    expect(result.status).toBe('ok');
    expect(result.kit.questions.length).toBeGreaterThan(0);
    expect(result.kit.source.notes.some((note) => note.includes('No behavioural questions'))).toBe(true);

    // Better than surviving: the missing category left the behavioural requirement uncovered, the
    // coverage check saw it, and the gap-filling pass closed it. The loop earns its keep here.
    expect(result.kit.coverage.passes).toBeGreaterThan(1);
    const behavioural = result.kit.role.requirements.filter((r) => r.kind === 'behavioural');
    for (const requirement of behavioural) {
      expect(result.kit.coverage.uncovered_requirement_ids).not.toContain(requirement.id);
    }
  });

  it('fails the case when the step everything depends on fails', async () => {
    // Without requirements there is no kit to produce, so this one genuinely is a failure.
    const good = createFakeClient();
    const client = {
      ...good,
      json: (call) => {
        if (call.purpose.startsWith('extract-requirements')) {
          throw new LlmOutputError('extract-requirements: reply was not JSON.', { raw: 'sorry' });
        }
        return good.json(call);
      },
    };

    const output = await runBatch({
      cases: casesFor(['acme']),
      client,
      research: createResearch({ allowPrivateUrls: true }),
    });

    expect(output.kits[0].status).toBe('failed');
    expect(output.kits[0].error.code).toBe('GENERATION_FAILED');
  });

  it('abandons a case that runs past its budget, and finishes the rest', async () => {
    const slow = createFakeClient();
    const client = {
      ...slow,
      json: async (call) => {
        if (call.user.includes('SLOW')) await new Promise((resolve) => setTimeout(resolve, 200));
        return slow.json(call);
      },
    };

    const output = await runBatch({
      cases: [
        makeCase({ id: 'slow', jd: 'SLOW engineer role.', company_url: `${fixtures.baseUrl}/acme/`, days: 2 }),
        makeCase({ id: 'quick', jd: 'Node engineer, 5 years.', company_url: `${fixtures.baseUrl}/acme/`, days: 2 }),
      ],
      client,
      research: createResearch({ allowPrivateUrls: true }),
      timeoutMs: 100,
    });

    expect(output.kits[0].status).toBe('failed');
    expect(output.kits[0].error.code).toBe('CASE_TIMEOUT');
    expect(output.kits[1].status).toBe('ok');
  });

  it('runs cases concurrently rather than one after another', async () => {
    let inFlight = 0;
    let peak = 0;
    const base = createFakeClient();
    const client = {
      ...base,
      json: async (call) => {
        inFlight += 1;
        peak = Math.max(peak, inFlight);
        await new Promise((resolve) => setTimeout(resolve, 5));
        inFlight -= 1;
        return base.json(call);
      },
    };

    await runBatch({
      cases: casesFor(['acme', 'northwind', 'borealis']),
      client,
      research: createResearch({ allowPrivateUrls: true }),
      concurrency: DEFAULT_CONCURRENCY,
    });

    expect(peak).toBeGreaterThan(1);
  });
});

describe('readCases', () => {
  it('reads the fixture cases file', async () => {
    const cases = await readCases(path.join(BACKEND, 'fixtures/cases.json'));
    expect(cases.length).toBeGreaterThanOrEqual(5);
    expect(cases[0]).toHaveProperty('company_url');
  });

  it('names the case and the field when the file is wrong', async () => {
    const file = path.join(workdir, 'bad.json');
    await fs.writeFile(file, JSON.stringify([{ id: 'x', jd: 'y', company_url: 'not-a-url', days: 0 }]));

    await expect(readCases(file)).rejects.toThrow(/0\.company_url|0\.days/);
  });

  it('refuses a file that is not JSON', async () => {
    const file = path.join(workdir, 'notjson.json');
    await fs.writeFile(file, 'cases: []');
    await expect(readCases(file)).rejects.toThrow(/Could not read/);
  });
});

describe('the command itself', () => {
  it('produces a valid kits file from a clean invocation', async () => {
    const input = path.join(workdir, 'cases.json');
    const output = path.join(workdir, 'kits.json');
    await fs.writeFile(input, JSON.stringify(casesFor(['acme', 'gone'])));

    const { stdout } = await run(
      process.execPath,
      ['scripts/evaluate.js', '--input', input, '--output', output, '--fake', '--allow-private-urls'],
      { cwd: BACKEND },
    );

    expect(stdout).toContain('2/2 kits');
    const written = JSON.parse(await fs.readFile(output, 'utf8'));
    expect(BatchOutputSchema.safeParse(written).success).toBe(true);

    // The company that 404s is a kit with a gap recorded, not a failed case.
    const unreachable = written.kits[1];
    expect(unreachable.status).toBe('ok');
    expect(unreachable.kit.source.pages_used).toEqual([]);
    expect(unreachable.kit.source.notes.some((note) => note.includes('404'))).toBe(true);
  }, 30_000);

  /**
   * Run from a directory with no .env and an empty environment. This is the clean-clone
   * condition the pipeline is evaluated under — no database URI, no auth secrets, nothing that
   * `dotenv` could quietly supply from the developer's own file.
   */
  const runClean = (args) =>
    run(process.execPath, [path.join(BACKEND, 'scripts/evaluate.js'), ...args], {
      cwd: workdir,
      env: { PATH: process.env.PATH },
    });

  it('runs with no environment and no .env at all, given --fake', async () => {
    const input = path.join(workdir, 'cases-clean.json');
    const output = path.join(workdir, 'kits-clean.json');
    await fs.writeFile(input, JSON.stringify(casesFor(['acme'])));

    const { stdout } = await runClean(['--input', input, '--output', output, '--fake', '--allow-private-urls']);

    expect(stdout).toContain('1/1 kits');
    const written = JSON.parse(await fs.readFile(output, 'utf8'));
    expect(BatchOutputSchema.safeParse(written).success).toBe(true);
  }, 30_000);

  it('says what to do when there is no API key and no --fake', async () => {
    const input = path.join(workdir, 'cases-nokey.json');
    await fs.writeFile(input, JSON.stringify(casesFor(['acme'])));

    const result = await runClean([
      '--input', input,
      '--output', path.join(workdir, 'unused.json'),
    ]).catch((error) => error);

    expect(result.stderr).toContain('GROQ_API_KEY');
    expect(result.stderr).toContain('console.groq.com');
  }, 30_000);
});
