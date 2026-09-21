#!/usr/bin/env node
/**
 * The batch entry point.
 *
 *   npm run evaluate -- --input fixtures/cases.json --output kits.json
 *
 * This runs the same pipeline the application runs — `generateKit()`, the real crawler, the real
 * model. Not a parallel implementation. It is also the development loop: no browser, no login, no
 * database, which is the condition the pipeline is evaluated under.
 *
 * It imports `pipeline/`, `llm/` and `schema/`, and nothing from `server/`. One stray import there
 * would drag in Mongoose and the auth secrets and break the clean-clone run.
 *
 * A case that fails is recorded and the run continues. A case that hangs is abandoned at its time
 * budget so one bad company site cannot eat the fifteen minutes the whole run has.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { pathToFileURL } from 'node:url';
import { performance } from 'node:perf_hooks';
import PQueue from 'p-queue';

import { createFakeClient } from '../src/llm/fake.js';
import { createGroqClient } from '../src/llm/index.js';
import { createResearch } from '../src/pipeline/crawl.js';
import { generateKit } from '../src/pipeline/generateKit.js';
import { BatchOutputSchema, CasesFileSchema, ERROR_CODES } from '../src/schema/batch.js';

/**
 * Cases in flight at once. The LLM calls underneath share one limiter however many run here, and
 * the free tier's ceiling is tokens per minute — so three at a time does not finish sooner, it
 * just spends the run waiting out rate limits.
 */
export const DEFAULT_CONCURRENCY = 2;

/**
 * Per case. Generous because the free tier is paced by tokens per minute: a kit is roughly ten
 * thousand tokens, so under an 8000 TPM ceiling it cannot finish much faster than a minute and a
 * half, and two running at once share that ceiling — the richest site in the fixtures took just
 * over four minutes. Five cases still land inside fifteen; this only decides when a case is stuck.
 */
export const DEFAULT_TIMEOUT_MS = 360_000;

const OPTIONS = {
  input: { type: 'string', short: 'i', default: 'fixtures/cases.json' },
  output: { type: 'string', short: 'o', default: 'kits.json' },
  concurrency: { type: 'string', short: 'c' },
  timeout: { type: 'string', short: 't' },
  fake: { type: 'boolean', default: false },
  'allow-private-urls': { type: 'boolean', default: false },
  help: { type: 'boolean', short: 'h', default: false },
};

const USAGE = `
Usage: npm run evaluate -- [options]

  -i, --input <file>       cases to run           (default: fixtures/cases.json)
  -o, --output <file>      where to write kits    (default: kits.json)
  -c, --concurrency <n>    cases at once          (default: ${DEFAULT_CONCURRENCY})
  -t, --timeout <ms>       per-case budget        (default: ${DEFAULT_TIMEOUT_MS})
      --fake               use the stand-in model; no API key needed
      --allow-private-urls reach localhost and private addresses (fixture sites)
  -h, --help               this

Needs GROQ_API_KEY in backend/.env unless --fake is given. Nothing else.
Free key, no card: https://console.groq.com/keys
`.trim();

/** Everything that reaches the envelope as a failure, with a code from the agreed list. */
class CaseFailure extends Error {
  constructor(code, message, { cause } = {}) {
    super(message, { cause });
    this.name = 'CaseFailure';
    this.code = code;
  }
}

/** Abandons a case at its budget. The work itself cannot be cancelled; the run stops waiting. */
function withTimeout(promise, ms, id) {
  let timer;
  const clock = new Promise((_, reject) => {
    timer = setTimeout(
      () => reject(new CaseFailure(ERROR_CODES.CASE_TIMEOUT, `${id} ran past ${ms}ms and was abandoned.`)),
      ms,
    );
  });
  return Promise.race([promise, clock]).finally(() => clearTimeout(timer));
}

/** Maps whatever went wrong onto a code the envelope allows. */
function classify(error) {
  if (error instanceof CaseFailure) return error;
  if (error?.name === 'ZodError') {
    return new CaseFailure(ERROR_CODES.INVALID_KIT, 'The kit produced did not match the schema.', {
      cause: error,
    });
  }
  if (error?.name?.startsWith('Llm')) {
    return new CaseFailure(ERROR_CODES.GENERATION_FAILED, error.message, { cause: error });
  }
  return new CaseFailure(ERROR_CODES.UNEXPECTED_ERROR, error?.message ?? String(error), {
    cause: error,
  });
}

/**
 * Runs every case and returns the output envelope. Pure with respect to the filesystem — the
 * caller reads the input and writes the result, so this is testable without either.
 *
 * @param {{cases: object[], client: object, research?: Function, concurrency?: number,
 *          timeoutMs?: number, onEvent?: Function, now?: () => Date}} input
 */
export async function runBatch({
  cases,
  client,
  research,
  concurrency = DEFAULT_CONCURRENCY,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  onEvent = () => {},
  now = () => new Date(),
}) {
  const queue = new PQueue({ concurrency });

  // Results are placed by index, so the output order matches the input order however the queue
  // interleaves them.
  const results = new Array(cases.length);

  await Promise.all(
    cases.map((testCase, index) =>
      queue.add(async () => {
        const startedAt = performance.now();
        onEvent({ type: 'case:start', id: testCase.id });

        try {
          const kit = await withTimeout(
            generateKit({ ...testCase, client, research }),
            timeoutMs,
            testCase.id,
          );
          results[index] = { id: testCase.id, status: 'ok', kit, error: null };
          onEvent({
            type: 'case:ok',
            id: testCase.id,
            ms: Math.round(performance.now() - startedAt),
            questions: kit.questions.length,
            uncovered: kit.coverage.uncovered_requirement_ids.length,
            pages: kit.source.pages_used.length,
          });
        } catch (error) {
          // One failure never aborts the run. It is recorded and the queue carries on.
          const failure = classify(error);
          results[index] = {
            id: testCase.id,
            status: 'failed',
            kit: null,
            error: { code: failure.code, message: failure.message },
          };
          onEvent({
            type: 'case:failed',
            id: testCase.id,
            ms: Math.round(performance.now() - startedAt),
            code: failure.code,
            message: failure.message,
          });
        }
      }),
    ),
  );

  return BatchOutputSchema.parse({
    version: '1.0',
    generated_at: now().toISOString(),
    kits: results,
  });
}

/** Reads and validates the cases file, with a message that says which case is wrong. */
export async function readCases(file) {
  let parsed;
  try {
    parsed = JSON.parse(await fs.readFile(file, 'utf8'));
  } catch (cause) {
    throw new Error(`Could not read ${file}: ${cause.message}`, { cause });
  }

  const result = CasesFileSchema.safeParse(parsed);
  if (!result.success) {
    const lines = result.error.issues.map((issue) => `  ${issue.path.join('.')}: ${issue.message}`);
    throw new Error(`${file} is not a valid cases file:\n${lines.join('\n')}`);
  }
  return result.data;
}

function buildClient({ fake }) {
  if (fake) return createFakeClient();

  // The key is checked here, at the entry point — never in a shared config module that would also
  // demand a database URI and stop this command running without one.
  if (!process.env.GROQ_API_KEY) {
    throw new Error(
      'GROQ_API_KEY is not set. Put it in backend/.env (free key, no card: https://console.groq.com/keys), or run with --fake.',
    );
  }
  return createGroqClient();
}

async function main() {
  const { values } = parseArgs({ options: OPTIONS, allowPositionals: false });
  if (values.help) {
    console.log(USAGE);
    return;
  }

  const dotenv = await import('dotenv');
  dotenv.config({ quiet: true });

  const concurrency = Number(values.concurrency ?? DEFAULT_CONCURRENCY);
  const timeoutMs = Number(values.timeout ?? DEFAULT_TIMEOUT_MS);
  const allowPrivateUrls = values['allow-private-urls'] || process.env.ALLOW_PRIVATE_URLS === 'true';

  const cases = await readCases(values.input);
  const client = buildClient(values);

  console.log(
    `evaluate: ${cases.length} cases, ${concurrency} at a time, ${client.name} model${
      client.model && client.name !== 'fake' ? ` (${client.model})` : ''
    }`,
  );

  const startedAt = performance.now();
  const output = await runBatch({
    cases,
    client,
    research: createResearch({ allowPrivateUrls }),
    concurrency,
    timeoutMs,
    onEvent: report,
  });

  await fs.mkdir(path.dirname(path.resolve(values.output)), { recursive: true });
  await fs.writeFile(values.output, `${JSON.stringify(output, null, 2)}\n`);

  const ok = output.kits.filter((kit) => kit.status === 'ok').length;
  const seconds = ((performance.now() - startedAt) / 1000).toFixed(1);
  console.log(`\n${ok}/${output.kits.length} kits in ${seconds}s -> ${values.output}`);

  // A run where every case failed is a failed run, and the exit code should say so.
  if (ok === 0) process.exitCode = 1;
}

function report(event) {
  const seconds = event.ms ? `${(event.ms / 1000).toFixed(1)}s` : '';
  if (event.type === 'case:start') console.log(`  ${event.id}: running`);
  if (event.type === 'case:ok') {
    console.log(
      `  ${event.id}: ok in ${seconds} — ${event.questions} questions, ${event.pages} pages read, ${event.uncovered} uncovered`,
    );
  }
  if (event.type === 'case:failed') {
    console.log(`  ${event.id}: FAILED in ${seconds} — ${event.code}: ${event.message}`);
  }
}

// Only run when invoked as a command, so tests can import runBatch without starting a batch.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(`\nevaluate failed: ${error.message}`);
    process.exitCode = 1;
  });
}
