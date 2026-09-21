/**
 * The builder's rules, as pure functions over a kit object.
 *
 * PROJECT.md calls regeneration-preserving-edits "the hardest state problem in the project", and
 * this module is where the state part of it lives: every mutation goes through here, so `origin`
 * transitions, id minting, and the two invariants that a hand edit can break — the schedule
 * referencing a deleted question, and coverage going stale — are handled in one place rather than
 * in nine route handlers.
 *
 * Nothing here touches the database or `req`. A kit goes in, a kit comes out, and the caller saves
 * it. Every path ends at `finalise()`, which is the only way a kit reaches storage.
 */
import { KitSchema } from '../../schema/kit.js';
import { MAX_DAY_MINUTES, MINUTES_PER_QUESTION } from '../../pipeline/schedule.js';
import { checkCoverage } from '../../pipeline/coverage.js';
import { HttpError, badRequest, notFound } from '../http/errors.js';

/**
 * `q7` after `q6`, and never an id this kit has used before — reusing one would silently
 * reassign a schedule entry or a practice record to different material.
 */
export function nextId(prefix, items) {
  const highest = items.reduce((max, item) => {
    const match = new RegExp(`^${prefix}(\\d+)$`).exec(item.id ?? '');
    return match ? Math.max(max, Number(match[1])) : max;
  }, 0);
  return `${prefix}${highest + 1}`;
}

const clone = (kit) => structuredClone(kit);

const findIndexById = (items, id) => items.findIndex((item) => item.id === id);

function requireItem(items, id, label) {
  const index = findIndexById(items, id);
  if (index === -1) throw notFound(`No ${label} "${id}" in this kit.`);
  return index;
}

/**
 * An edit to a generated item makes it the user's: regeneration must not throw it away. An item
 * they wrote themselves is already `pinned` and stays that way.
 */
const originAfterEdit = (origin) => (origin === 'pinned' ? 'pinned' : 'edited');

/** Requirement ids are the spine of coverage, so a reference to one that does not exist is a 400. */
function checkRequirementIds(kit, ids) {
  if (!ids) return;
  const known = new Set(kit.role.requirements.map((requirement) => requirement.id));
  const unknown = ids.filter((id) => !known.has(id));
  if (unknown.length > 0) {
    throw badRequest(`This kit has no requirement ${unknown.map((id) => `"${id}"`).join(', ')}.`);
  }
}

/**
 * Keeps the schedule honest after the question bank changes.
 *
 * A full rebuild would be simpler and would discard whatever the user had arranged, so instead:
 * deleted ids are dropped, ids in `place` are added to the lightest day, and only the days that
 * actually changed have their minutes recomputed. A day the user hand-edited and did not disturb
 * comes out exactly as they left it.
 *
 * `place` holds ids that have just appeared — a question added by hand, or one a regeneration
 * produced. Anything else that is on no day is left off one, because a user who took a question
 * out of a day meant to take it out.
 */
export function reconcileSchedule(kit, { place = [] } = {}) {
  const known = new Set(kit.questions.map((question) => question.id));
  const scheduled = new Set();
  const changed = new Set();

  kit.schedule.days = kit.schedule.days.map((day, index) => {
    const kept = day.question_ids.filter((id) => known.has(id));
    if (kept.length !== day.question_ids.length) changed.add(index);
    for (const id of kept) scheduled.add(id);
    return { ...day, question_ids: kept };
  });

  const toPlace = kit.questions.filter(
    (question) => place.includes(question.id) && !scheduled.has(question.id),
  );
  for (const question of toPlace) {
    // Lightest day wins, earliest day breaks the tie — a new question lands where there is room
    // rather than always on day one.
    let lightest = 0;
    kit.schedule.days.forEach((day, index) => {
      if (day.question_ids.length < kit.schedule.days[lightest].question_ids.length) lightest = index;
    });
    kit.schedule.days[lightest].question_ids.push(question.id);
    changed.add(lightest);
  }

  for (const index of changed) {
    const day = kit.schedule.days[index];
    day.minutes = Math.min(MAX_DAY_MINUTES, day.question_ids.length * MINUTES_PER_QUESTION);
  }

  return kit;
}

/** Coverage is a set difference over the current bank — never a stored opinion (RULES.md). */
export function recomputeCoverage(kit) {
  const coverage = checkCoverage({
    requirements: kit.role.requirements,
    questions: kit.questions,
  });
  kit.coverage = {
    ...kit.coverage,
    uncovered_requirement_ids: coverage.uncovered_requirement_ids,
  };
  return kit;
}

/**
 * The only door out of this module. Reconciles, recomputes, and validates — "Always validate a kit
 * against the schema before saving it" applies to a one-word edit exactly as it does to a
 * freshly generated kit.
 */
export function finalise(kit, { place = [] } = {}) {
  const settled = recomputeCoverage(reconcileSchedule(kit, { place }));
  const result = KitSchema.safeParse(settled);
  if (!result.success) {
    throw new HttpError(422, 'INVALID_KIT', 'That change would leave the kit invalid.', {
      detail: result.error.issues.slice(0, 5).map((issue) => ({
        field: issue.path.join('.'),
        message: issue.message,
      })),
    });
  }
  return result.data;
}

// ── Questions ───────────────────────────────────────────────────────────────────────────────

export function editQuestion(source, id, patch) {
  const kit = clone(source);
  const index = requireItem(kit.questions, id, 'question');
  checkRequirementIds(kit, patch.requirement_ids);

  const question = kit.questions[index];
  // A category change is how a question moves between categories; there is no separate move call.
  kit.questions[index] = { ...question, ...patch, origin: originAfterEdit(question.origin) };
  return finalise(kit);
}

/** Added by hand, so `pinned`: a regeneration of its category must leave it alone. */
export function addQuestion(source, input) {
  const kit = clone(source);
  checkRequirementIds(kit, input.requirement_ids);
  const id = nextId('q', kit.questions);
  kit.questions.push({ ...input, id, origin: 'pinned' });
  // A question nobody can see on any day is a question nobody will practise.
  return finalise(kit, { place: [id] });
}

export function deleteQuestion(source, id) {
  const kit = clone(source);
  const index = requireItem(kit.questions, id, 'question');
  kit.questions.splice(index, 1);
  // The schedule still names it; reconcileSchedule inside finalise() takes it back out.
  return finalise(kit);
}

// ── Flashcards ──────────────────────────────────────────────────────────────────────────────

export function editFlashcard(source, id, patch) {
  const kit = clone(source);
  const index = requireItem(kit.flashcards, id, 'flashcard');
  checkRequirementIds(kit, patch.requirement_ids);

  const card = kit.flashcards[index];
  kit.flashcards[index] = { ...card, ...patch, origin: originAfterEdit(card.origin) };
  return finalise(kit);
}

export function addFlashcard(source, input) {
  const kit = clone(source);
  checkRequirementIds(kit, input.requirement_ids);
  kit.flashcards.push({ ...input, id: nextId('f', kit.flashcards), origin: 'pinned' });
  return finalise(kit);
}

export function deleteFlashcard(source, id) {
  const kit = clone(source);
  const index = requireItem(kit.flashcards, id, 'flashcard');
  kit.flashcards.splice(index, 1);
  return finalise(kit);
}

// ── Ordering ────────────────────────────────────────────────────────────────────────────────

/**
 * Reordering takes the ids in their new order. They may be a subset — dragging within one
 * category sends only that category — in which case those items are rearranged among the
 * positions they already occupy and everything else stays where it is.
 */
export function reorderItems(items, ids, label) {
  const unique = new Set(ids);
  if (unique.size !== ids.length) throw badRequest(`The ${label} order repeats an id.`);

  const byId = new Map(items.map((item) => [item.id, item]));
  const missing = ids.filter((id) => !byId.has(id));
  if (missing.length > 0) {
    throw notFound(`No ${label} ${missing.map((id) => `"${id}"`).join(', ')} in this kit.`);
  }

  const slots = items.map((item, index) => (unique.has(item.id) ? index : -1)).filter((i) => i >= 0);
  const reordered = [...items];
  slots.forEach((slot, position) => {
    reordered[slot] = byId.get(ids[position]);
  });
  return reordered;
}

export function reorderQuestions(source, ids) {
  const kit = clone(source);
  kit.questions = reorderItems(kit.questions, ids, 'question');
  return finalise(kit);
}

export function reorderFlashcards(source, ids) {
  const kit = clone(source);
  kit.flashcards = reorderItems(kit.flashcards, ids, 'flashcard');
  return finalise(kit);
}

// ── Brief, role, schedule ───────────────────────────────────────────────────────────────────

export function editBrief(source, patch) {
  const kit = clone(source);
  kit.company_brief = { ...kit.company_brief, ...patch };
  return finalise(kit);
}

export function editRole(source, patch) {
  const kit = clone(source);
  kit.role = { ...kit.role, ...patch };
  // The role's title is what the kit is listed under, so the two must not drift apart.
  if (patch.title) kit.source = { ...kit.source, role: patch.title };
  return finalise(kit);
}

export function editScheduleDay(source, dayNumber, patch) {
  const kit = clone(source);
  const index = kit.schedule.days.findIndex((day) => day.day === dayNumber);
  if (index === -1) throw notFound(`This schedule has no day ${dayNumber}.`);

  if (patch.question_ids) {
    const known = new Set(kit.questions.map((question) => question.id));
    const unknown = patch.question_ids.filter((id) => !known.has(id));
    if (unknown.length > 0) {
      throw badRequest(`This kit has no question ${unknown.map((id) => `"${id}"`).join(', ')}.`);
    }
    if (new Set(patch.question_ids).size !== patch.question_ids.length) {
      throw badRequest('A day cannot list the same question twice.');
    }
  }

  kit.schedule.days[index] = { ...kit.schedule.days[index], ...patch };
  return finalise(kit);
}
