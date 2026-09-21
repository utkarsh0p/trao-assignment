/**
 * The study schedule.
 *
 * Spreading the question bank across exactly the days the user has is arithmetic, so it is written
 * here and never asked of the model (RULES.md -> "Never let the model decide the schedule").
 *
 * The rules it has to satisfy, from PROJECT.md -> "The schedule":
 *   - exactly `days_available` days, numbered 1..N, no gaps and no repeats
 *   - every must-have requirement that has a question appears somewhere
 *   - harder and higher-priority material lands earlier, not the night before
 *   - integer minutes, always
 *
 * Two shapes have to work. With more questions than days, the ordered bank is cut into N
 * contiguous blocks, so day 1 holds the hardest must-haves. With more days than questions the bank
 * is repeated until it fills the calendar, which turns the surplus into spaced review rather than
 * empty filler days.
 *
 * Pure. No I/O. Imports the category list from schema/ and nothing else.
 */
import { QUESTION_CATEGORIES } from '../schema/kit.js';

/** A question is worth about a quarter of an hour: read it, answer it aloud, check the outline. */
export const MINUTES_PER_QUESTION = 15;

/** Nobody revises for six hours. A day that overflows is capped rather than promised honestly. */
export const MAX_DAY_MINUTES = 180;

const CATEGORY_LABELS = {
  technical: 'Technical',
  behavioural: 'Behavioural',
  'system-design': 'System design',
  'company-fit': 'Company fit',
};

function assertDayCount(daysAvailable) {
  if (!Number.isInteger(daysAvailable) || daysAvailable < 1) {
    throw new TypeError(`daysAvailable must be an integer of at least 1, received ${daysAvailable}.`);
  }
}

/**
 * Highest-priority, hardest material first. Ties fall back to the order the questions arrived in,
 * which keeps the whole function deterministic — the same kit input always produces the same
 * schedule.
 */
export function orderQuestions(questions = [], requirements = []) {
  const mustIds = new Set(
    requirements.filter((requirement) => requirement.priority === 'must').map((r) => r.id),
  );

  return questions
    .map((question, index) => ({
      question,
      index,
      coversMust: (question.requirement_ids ?? []).some((id) => mustIds.has(id)),
    }))
    .sort(
      (a, b) =>
        Number(b.coversMust) - Number(a.coversMust) ||
        b.question.difficulty - a.question.difficulty ||
        a.index - b.index,
    )
    .map((entry) => entry.question);
}

/** Splits `total` into `groups` near-equal sizes, the larger ones first. Never returns a zero. */
function chunkSizes(total, groups) {
  const base = Math.floor(total / groups);
  const remainder = total % groups;
  return Array.from({ length: groups }, (_, i) => base + (i < remainder ? 1 : 0));
}

/** What the day is about: its dominant category, or its top two when it is genuinely mixed. */
function describe(dayQuestions, isReview) {
  const counts = new Map();
  for (const question of dayQuestions) {
    counts.set(question.category, (counts.get(question.category) ?? 0) + 1);
  }

  const ranked = [...counts.keys()].sort(
    (a, b) =>
      counts.get(b) - counts.get(a) ||
      QUESTION_CATEGORIES.indexOf(a) - QUESTION_CATEGORIES.indexOf(b),
  );

  const label =
    ranked.length > 1
      ? `${CATEGORY_LABELS[ranked[0]]} and ${CATEGORY_LABELS[ranked[1]].toLowerCase()}`
      : CATEGORY_LABELS[ranked[0]];

  return isReview ? `Review — ${label.toLowerCase()}` : label;
}

/**
 * @param {{ requirements?: object[], questions?: object[], daysAvailable: number }} input
 * @returns {{ days_available: number, days: Array<{day: number, focus: string,
 *             question_ids: string[], minutes: number}> }} a `schedule` ready for the kit.
 */
export function buildSchedule({ requirements = [], questions = [], daysAvailable } = {}) {
  assertDayCount(daysAvailable);

  const ordered = orderQuestions(questions, requirements);

  // No questions is a thin kit, not a broken one. Say so on every day rather than inventing work.
  if (ordered.length === 0) {
    return {
      days_available: daysAvailable,
      days: Array.from({ length: daysAvailable }, (_, i) => ({
        day: i + 1,
        focus: 'No questions in this kit yet',
        question_ids: [],
        minutes: 0,
      })),
    };
  }

  // Repeat the bank only when there are more days than questions; the repeats become review days.
  const passes = Math.ceil(daysAvailable / ordered.length);
  const sequence = Array.from({ length: passes }, () => ordered).flat();
  const sizes = chunkSizes(sequence.length, daysAvailable);

  const seen = new Set();
  const days = [];
  let cursor = 0;

  for (let i = 0; i < daysAvailable; i += 1) {
    const slice = sequence.slice(cursor, cursor + sizes[i]);
    cursor += sizes[i];

    const dayQuestions = [];
    for (const question of slice) {
      if (!dayQuestions.some((q) => q.id === question.id)) dayQuestions.push(question);
    }

    const isReview = dayQuestions.every((question) => seen.has(question.id));
    for (const question of dayQuestions) seen.add(question.id);

    days.push({
      day: i + 1,
      focus: describe(dayQuestions, isReview),
      question_ids: dayQuestions.map((question) => question.id),
      minutes: Math.min(dayQuestions.length * MINUTES_PER_QUESTION, MAX_DAY_MINUTES),
    });
  }

  return { days_available: daysAvailable, days };
}

export default buildSchedule;
