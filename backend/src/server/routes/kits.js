/**
 * Everything a signed-in user does with their kits: create one, watch it being generated, read it,
 * reshape it, regenerate a section of it, throw it away.
 *
 * Two rules run through the whole file.
 *
 * Every read and every write is scoped by `req.user.id` inside the query — `findById({id, userId})`,
 * never fetch-then-compare — and a kit belonging to someone else comes back 404, not 403, so the
 * existence of other people's kits does not leak (RULES.md).
 *
 * Every mutation goes through `kits/edit.js`, which validates the result against KitSchema before
 * it can reach the store. No handler here assembles a kit by hand.
 */
import { Router } from 'express';

import { KIT_STATUSES } from '../store/index.js';
import { conflict, notFound } from '../http/errors.js';
import { parseBody, validateBody } from '../http/validate.js';
import {
  BatchKitsBody,
  BriefPatch,
  CreateKitBody,
  FlashcardPatch,
  NewFlashcardBody,
  NewQuestionBody,
  QuestionPatch,
  RegenerateBody,
  ReorderBody,
  RolePatch,
  ScheduleDayPatch,
} from '../http/schemas.js';
import {
  addFlashcard,
  addQuestion,
  deleteFlashcard,
  deleteQuestion,
  editBrief,
  editFlashcard,
  editQuestion,
  editRole,
  editScheduleDay,
  reorderFlashcards,
  reorderQuestions,
} from '../kits/edit.js';
import { idempotencyKey } from '../kits/idempotency.js';
import { isStale } from '../jobs/runner.js';

/** A job whose heartbeat stopped. Not a generation failure — a job that is no longer running. */
export const STALE_ERROR = Object.freeze({
  code: 'JOB_STALE',
  message: 'Generation stopped unexpectedly, most likely because the server restarted. Try again.',
});

/** The list view: enough to render a card, without shipping every kit in full. */
function summarise(record) {
  return {
    id: record.id,
    status: record.status,
    company: record.kit?.source.company ?? '',
    company_url: record.input.company_url,
    role: record.kit?.source.role ?? '',
    days: record.input.days,
    questions: record.kit?.questions.length ?? 0,
    uncovered: record.kit?.coverage.uncovered_requirement_ids.length ?? 0,
    error: record.error ?? null,
    created_at: new Date(record.createdAt).toISOString(),
    updated_at: new Date(record.updatedAt).toISOString(),
  };
}

/**
 * The detail view. `kit` is null until there is one, and `progress` is what the client polls while
 * it waits — status and per-step progress while running, the full kit when ready.
 */
function present(record) {
  return {
    id: record.id,
    status: record.status,
    input: record.input,
    progress: record.progress ?? [],
    error: record.error ?? null,
    kit: record.kit ?? null,
    created_at: new Date(record.createdAt).toISOString(),
    updated_at: new Date(record.updatedAt).toISOString(),
  };
}

export function createKitsRouter({
  store,
  runner,
  generationLimiter = (req, res, next) => next(),
  now = Date.now,
}) {
  const router = Router();

  /** Loads a kit record for the signed-in user, or 404s. Nothing below runs without it. */
  async function load(req) {
    const record = await store.kits.findById({ id: req.params.id, userId: req.user.id });
    if (!record) throw notFound('No such kit.');
    return record;
  }

  /** For the editing routes: a kit that is still being generated has nothing to edit yet. */
  async function loadReady(req) {
    const record = await load(req);
    if (!record.kit) {
      throw conflict(
        record.status === KIT_STATUSES.FAILED
          ? 'That kit could not be generated, so there is nothing to edit.'
          : 'That kit is still being generated.',
      );
    }
    return record;
  }

  /** Applies a pure edit from `kits/edit.js` and saves the result. */
  async function apply(req, res, change) {
    const record = await loadReady(req);
    const kit = change(record.kit);
    const saved = await store.kits.update({ id: record.id, userId: req.user.id, patch: { kit } });
    res.json({ id: saved.id, kit: saved.kit });
  }

  /** Starts a job without making the response wait for it. */
  function startGeneration(record) {
    // Deliberately not awaited: the client already has its 202 and polls from here. An unhandled
    // rejection would take the process down, so the runner's own catch is the last line of defence
    // and this one is the fallback for a store that is unreachable.
    setImmediate(() => {
      runner.generate(record).catch(() => {});
    });
  }

  // ── Creating ──────────────────────────────────────────────────────────────────────────────

  router.post('/', generationLimiter, validateBody(CreateKitBody), async (req, res) => {
    const key = idempotencyKey(req.body, req.get('idempotency-key'));
    const existing = await store.kits.findByIdempotencyKey({ userId: req.user.id, idempotencyKey: key });

    if (existing) {
      // 200 rather than 202: nothing new was accepted. The client polls the same id either way.
      res.status(200).json({ ...summarise(existing), duplicate: true });
      return;
    }

    const record = await store.kits.create({
      userId: req.user.id,
      input: req.body,
      idempotencyKey: key,
    });

    startGeneration(record);
    res.status(202).json({ ...summarise(record), duplicate: false });
  });

  /**
   * The batch upload — "a file of description-and-company pairs to prepare for several roles at
   * once". Each pair becomes its own job with its own idempotency key, so a re-upload of a file
   * with one new row starts one new job rather than twenty.
   */
  router.post('/batch', generationLimiter, validateBody(BatchKitsBody), async (req, res) => {
    const results = [];

    for (const item of req.body.items) {
      const key = idempotencyKey(item, undefined);
      const existing = await store.kits.findByIdempotencyKey({
        userId: req.user.id,
        idempotencyKey: key,
      });

      if (existing) {
        results.push({ ...summarise(existing), duplicate: true });
        continue;
      }

      const record = await store.kits.create({
        userId: req.user.id,
        input: item,
        idempotencyKey: key,
      });
      startGeneration(record);
      results.push({ ...summarise(record), duplicate: false });
    }

    res.status(202).json({ kits: results });
  });

  // ── Reading ───────────────────────────────────────────────────────────────────────────────

  router.get('/', async (req, res) => {
    const records = await store.kits.listByUser(req.user.id);
    res.json({ kits: records.map(summarise) });
  });

  router.get('/:id', async (req, res) => {
    let record = await load(req);

    // Stale-job detection. A job that claims to be running but stopped heartbeating is not coming
    // back — the process was redeployed or killed mid-kit — so the client is told that once,
    // rather than polling a spinner for ever.
    if (isStale(record, { now })) {
      record =
        (await store.kits.update({
          id: record.id,
          userId: req.user.id,
          patch: { status: KIT_STATUSES.FAILED, error: STALE_ERROR },
        })) ?? record;
    }

    res.json(present(record));
  });

  router.delete('/:id', async (req, res) => {
    const removed = await store.kits.remove({ id: req.params.id, userId: req.user.id });
    if (!removed) throw notFound('No such kit.');
    res.status(204).end();
  });

  // ── The builder ───────────────────────────────────────────────────────────────────────────

  router.patch('/:id/brief', async (req, res) => {
    const patch = parseBody(BriefPatch, req.body);
    await apply(req, res, (kit) => editBrief(kit, patch));
  });

  router.patch('/:id/role', async (req, res) => {
    const patch = parseBody(RolePatch, req.body);
    await apply(req, res, (kit) => editRole(kit, patch));
  });

  router.post('/:id/questions', async (req, res) => {
    const body = parseBody(NewQuestionBody, req.body);
    await apply(req, res, (kit) => addQuestion(kit, body));
  });

  /**
   * Also how a question moves between categories: send `{"category": "behavioural"}`. There is no
   * separate move endpoint, because a move is an edit to one field.
   */
  router.patch('/:id/questions/:questionId', async (req, res) => {
    const patch = parseBody(QuestionPatch, req.body);
    await apply(req, res, (kit) => editQuestion(kit, req.params.questionId, patch));
  });

  router.delete('/:id/questions/:questionId', async (req, res) => {
    await apply(req, res, (kit) => deleteQuestion(kit, req.params.questionId));
  });

  router.post('/:id/questions/reorder', async (req, res) => {
    const { ids } = parseBody(ReorderBody, req.body);
    await apply(req, res, (kit) => reorderQuestions(kit, ids));
  });

  router.post('/:id/flashcards', async (req, res) => {
    const body = parseBody(NewFlashcardBody, req.body);
    await apply(req, res, (kit) => addFlashcard(kit, body));
  });

  router.patch('/:id/flashcards/:cardId', async (req, res) => {
    const patch = parseBody(FlashcardPatch, req.body);
    await apply(req, res, (kit) => editFlashcard(kit, req.params.cardId, patch));
  });

  router.delete('/:id/flashcards/:cardId', async (req, res) => {
    await apply(req, res, (kit) => deleteFlashcard(kit, req.params.cardId));
  });

  router.post('/:id/flashcards/reorder', async (req, res) => {
    const { ids } = parseBody(ReorderBody, req.body);
    await apply(req, res, (kit) => reorderFlashcards(kit, ids));
  });

  router.patch('/:id/schedule/days/:day', async (req, res) => {
    const patch = parseBody(ScheduleDayPatch, req.body);
    await apply(req, res, (kit) => editScheduleDay(kit, Number(req.params.day), patch));
  });

  // ── Regeneration ──────────────────────────────────────────────────────────────────────────

  /**
   * One section at a time, and only the `generated` items within it: anything the user edited or
   * wrote survives. The reply is 202 and the client polls `GET /kits/:id` exactly as it does for a
   * first generation — the existing kit stays readable while the new section is produced.
   */
  router.post('/:id/regenerate', generationLimiter, validateBody(RegenerateBody), async (req, res) => {
    const record = await loadReady(req);
    if (record.status === KIT_STATUSES.REGENERATING || record.status === KIT_STATUSES.RUNNING) {
      throw conflict('That kit is already being worked on.');
    }

    const { section, category } = req.body;
    setImmediate(() => {
      runner.regenerate(record, { section, category }).catch(() => {});
    });

    res.status(202).json({
      id: record.id,
      status: KIT_STATUSES.REGENERATING,
      section,
      ...(category ? { category } : {}),
    });
  });

  return router;
}

export default createKitsRouter;
