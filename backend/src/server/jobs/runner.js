/**
 * Generation as a background job.
 *
 * `POST /kits` answers 202 and then keeps working — STACK.md's reason for Express on Render rather
 * than serverless route handlers, which are frozen the moment they respond. The runner is what
 * keeps working: it calls the same `generateKit()` the batch command calls, writes each step's
 * progress where the polling client can see it, and records a failure as a state rather than
 * losing it to an unhandled rejection.
 *
 * Three things make a job observable from outside this process:
 *   · `progress`  — the per-step events the UI renders
 *   · `updatedAt` — a heartbeat, moved every few seconds so a dead job can be told from a slow one
 *   · `status`    — queued → running → ready | failed
 */
import { KitSchema } from '../../schema/kit.js';
import { generateKit } from '../../pipeline/generateKit.js';
import { ERROR_CODES } from '../../schema/batch.js';
import { KIT_STATUSES } from '../store/index.js';
import { regenerateSection } from '../kits/regenerate.js';

/** How often the job says it is still alive while a single LLM call is in flight. */
export const HEARTBEAT_MS = 10_000;

/**
 * A job whose heartbeat has been quiet this long is not running any more — the process was
 * redeployed, or it crashed in a way that took the catch block with it. Generously more than the
 * heartbeat interval, because a paused event loop is not a dead job.
 */
export const STALE_AFTER_MS = 5 * 60_000;

/**
 * The whole job, end to end. The batch command allows four minutes a case with two running at
 * once; a single interactive job has the rate limiter to itself, so this is the outer bound on
 * something being stuck rather than a pace it is expected to keep.
 */
export const JOB_TIMEOUT_MS = 8 * 60_000;

/**
 * One entry per step, in the order the steps first appeared, holding that step's latest state.
 *
 * Generation reports `generate` four times — once per category — so the key includes the category
 * or section when there is one. Without that, the four category calls would overwrite each other
 * and the client would see a single `generate` bar for the longest part of the job.
 */
export const progressKey = (event) =>
  [event.step, event.detail?.category ?? event.detail?.section ?? ''].join(':');

export function mergeProgress(progress, event) {
  const index = progress.findIndex((entry) => progressKey(entry) === progressKey(event));
  if (index === -1) return [...progress, event];

  const merged = [...progress];
  merged[index] = event;
  return merged;
}

/** Maps anything thrown onto a code the client can branch on, sharing the batch command's list. */
export function classifyError(error) {
  if (error?.name === 'ZodError') {
    return { code: ERROR_CODES.INVALID_KIT, message: 'The kit produced did not match the schema.' };
  }
  if (error?.name === 'LlmOutputError' || error?.name === 'LlmRequestError') {
    return { code: ERROR_CODES.GENERATION_FAILED, message: error.message };
  }
  if (error?.code === ERROR_CODES.CASE_TIMEOUT) {
    return { code: ERROR_CODES.CASE_TIMEOUT, message: error.message };
  }
  // A rule from the HTTP layer — "this kit has no requirements to write questions about" — keeps
  // its own code when it surfaces in a background job rather than in a response.
  if (error?.name === 'HttpError') {
    return { code: error.code, message: error.message };
  }
  return { code: ERROR_CODES.UNEXPECTED_ERROR, message: error?.message ?? String(error) };
}

/** True when the record claims to be working but has not said anything for a long time. */
export function isStale(record, { now = Date.now, staleAfterMs = STALE_AFTER_MS } = {}) {
  const active = record.status === KIT_STATUSES.QUEUED
    || record.status === KIT_STATUSES.RUNNING
    || record.status === KIT_STATUSES.REGENERATING;
  if (!active) return false;
  return now() - new Date(record.updatedAt).getTime() > staleAfterMs;
}

export function createJobRunner({
  store,
  client,
  research,
  logger = console,
  heartbeatMs = HEARTBEAT_MS,
  timeoutMs = JOB_TIMEOUT_MS,
  now = () => new Date(),
}) {
  /**
   * Progress writes are chained rather than fired in parallel: two updates racing would let the
   * older one land last and rewind the step list the client is watching.
   */
  function progressWriter(id) {
    let progress = [];
    let chain = Promise.resolve();

    return {
      get current() {
        return progress;
      },
      record(event) {
        progress = mergeProgress(progress, { ...event, at: now().toISOString() });
        const snapshot = progress;
        chain = chain
          .then(() => store.kits.update({ id, patch: { progress: snapshot } }))
          .catch((error) => logger.error(`kit ${id}: progress write failed`, error));
        return chain;
      },
      settled: () => chain,
    };
  }

  /** The heartbeat. Runs while the LLM is thinking, which is most of the job's life. */
  function beat(id) {
    const timer = setInterval(() => {
      store.kits.touch(id).catch(() => {});
    }, heartbeatMs);
    timer.unref?.();
    return () => clearInterval(timer);
  }

  function withTimeout(promise, id) {
    let timer;
    const clock = new Promise((_, reject) => {
      timer = setTimeout(() => {
        const error = new Error(`Generation ran past ${Math.round(timeoutMs / 1000)}s and was abandoned.`);
        error.code = ERROR_CODES.CASE_TIMEOUT;
        reject(error);
      }, timeoutMs);
      timer.unref?.();
    });
    return Promise.race([promise, clock]).finally(() => clearTimeout(timer));
  }

  /**
   * RULES.md: "Always validate a kit against the schema before saving it." generateKit() already
   * returns a parsed kit and `finalise()` already validates an edit — this is the belt to those
   * braces, and it is the only place a kit is written to storage.
   */
  async function save(id, patch) {
    if (patch.kit) KitSchema.parse(patch.kit);
    return store.kits.update({ id, patch });
  }

  /** Runs one job to completion. The route does not await it; tests do. */
  async function run(record, work, { failureStatus = KIT_STATUSES.FAILED } = {}) {
    const id = record.id;
    const progress = progressWriter(id);
    const stopBeat = beat(id);

    try {
      const kit = await withTimeout(work({ report: (step, status, detail) => progress.record({ step, status, ...(detail ? { detail } : {}) }) }), id);
      await progress.settled();
      await save(id, {
        status: KIT_STATUSES.READY,
        kit,
        error: null,
        progress: progress.current,
      });
      return kit;
    } catch (error) {
      const failure = classifyError(error);
      logger.error(`kit ${id} failed: ${failure.code} — ${failure.message}`);
      await progress.settled();
      await store.kits.update({
        id,
        patch: { status: failureStatus, error: failure, progress: progress.current },
      });
      return null;
    } finally {
      stopBeat();
    }
  }

  return {
    /** First generation. The record already exists, queued, so the client has an id to poll. */
    async generate(record) {
      await store.kits.update({ id: record.id, patch: { status: KIT_STATUSES.RUNNING } });
      return run(record, ({ report }) =>
        generateKit({
          jd: record.input.jd,
          company_url: record.input.company_url,
          days: record.input.days,
          client,
          research,
          onProgress: (event) => report(event.step, event.status, event.detail),
          now,
        }),
      );
    },

    /**
     * Regeneration of one section. The existing kit stays readable throughout — the status says
     * `regenerating`, not `running`, and `kit` is only replaced once the new section is in hand.
     */
    async regenerate(record, { section, category }) {
      await store.kits.update({
        id: record.id,
        patch: { status: KIT_STATUSES.REGENERATING, error: null },
      });
      return run(
        record,
        ({ report }) =>
          regenerateSection({
            kit: record.kit,
            section,
            category,
            client,
            research,
            report: (step, status, detail) => report(step, status, detail),
            now,
          }),
        // A regeneration that fails leaves the kit it started from intact, so the kit is still
        // ready — what failed is the attempt, and that is what `error` records.
        { failureStatus: KIT_STATUSES.READY },
      );
    },

    isStale: (record) => isStale(record),
  };
}

export default createJobRunner;
