import { describe, expect, it } from 'vitest';
import {
  MAX_DAY_MINUTES,
  MINUTES_PER_QUESTION,
  buildSchedule,
  orderQuestions,
} from '../src/pipeline/schedule.js';
import { KitSchema } from '../src/schema/kit.js';
import { makeKit, makeQuestion, makeQuestions, makeRequirement } from './factories.js';

/** Two must-haves and a nice-to-have, with questions spread across them. */
function bank(questionCount) {
  const requirements = [
    makeRequirement('r1', { priority: 'must' }),
    makeRequirement('r2', { priority: 'must', kind: 'behavioural' }),
    makeRequirement('r3', { priority: 'nice' }),
  ];
  const questions = makeQuestions(questionCount, (i) => ({
    requirement_ids: [`r${(i % 3) + 1}`],
    category: i % 2 ? 'behavioural' : 'technical',
    difficulty: (i % 3) + 1,
  }));
  return { requirements, questions };
}

/** Every question id in the schedule, in day order. */
function scheduled(schedule) {
  return schedule.days.flatMap((day) => day.question_ids);
}

describe('buildSchedule', () => {
  it('fits everything into a single day when there is only one', () => {
    const { requirements, questions } = bank(9);
    const schedule = buildSchedule({ requirements, questions, daysAvailable: 1 });

    expect(schedule.days).toHaveLength(1);
    expect(schedule.days[0].day).toBe(1);
    expect(new Set(schedule.days[0].question_ids)).toEqual(new Set(questions.map((q) => q.id)));
  });

  it('spreads twelve questions over five days, each question exactly once', () => {
    const { requirements, questions } = bank(12);
    const schedule = buildSchedule({ requirements, questions, daysAvailable: 5 });

    expect(schedule.days_available).toBe(5);
    expect(schedule.days.map((day) => day.day)).toEqual([1, 2, 3, 4, 5]);
    expect(scheduled(schedule).sort()).toEqual(questions.map((q) => q.id).sort());
    // Near-equal blocks, the heavier ones first: 12 over 5 is 3,3,2,2,2.
    expect(schedule.days.map((day) => day.question_ids.length)).toEqual([3, 3, 2, 2, 2]);
  });

  it('fills sixty days from ten questions with review passes, never an empty day', () => {
    const { requirements, questions } = bank(10);
    const schedule = buildSchedule({ requirements, questions, daysAvailable: 60 });

    expect(schedule.days).toHaveLength(60);
    expect(schedule.days.map((day) => day.day)).toEqual(
      Array.from({ length: 60 }, (_, i) => i + 1),
    );
    for (const day of schedule.days) {
      expect(day.question_ids.length).toBeGreaterThan(0);
    }
    // Every question is studied, and the surplus days become review rather than filler.
    expect(new Set(scheduled(schedule))).toEqual(new Set(questions.map((q) => q.id)));
    expect(schedule.days.some((day) => day.focus.startsWith('Review'))).toBe(true);
    expect(schedule.days[0].focus.startsWith('Review')).toBe(false);
  });

  it('schedules every must-have requirement that has a question against it', () => {
    const { requirements, questions } = bank(11);

    for (const daysAvailable of [1, 3, 5, 17, 60]) {
      const schedule = buildSchedule({ requirements, questions, daysAvailable });
      const scheduledIds = new Set(scheduled(schedule));
      const coveredRequirements = new Set(
        questions
          .filter((question) => scheduledIds.has(question.id))
          .flatMap((question) => question.requirement_ids),
      );

      for (const requirement of requirements.filter((r) => r.priority === 'must')) {
        expect(coveredRequirements.has(requirement.id)).toBe(true);
      }
    }
  });

  it('puts must-have and harder material in the earliest days', () => {
    const requirements = [
      makeRequirement('r1', { priority: 'must' }),
      makeRequirement('r2', { priority: 'nice' }),
    ];
    const questions = [
      makeQuestion('easy-nice', { requirement_ids: ['r2'], difficulty: 1 }),
      makeQuestion('hard-nice', { requirement_ids: ['r2'], difficulty: 3 }),
      makeQuestion('easy-must', { requirement_ids: ['r1'], difficulty: 1 }),
      makeQuestion('hard-must', { requirement_ids: ['r1'], difficulty: 3 }),
    ];
    const schedule = buildSchedule({ requirements, questions, daysAvailable: 4 });

    expect(scheduled(schedule)).toEqual(['hard-must', 'easy-must', 'hard-nice', 'easy-nice']);
  });

  it('gives every day an integer duration, capped at a length a person can sit through', () => {
    const { requirements, questions } = bank(40);

    for (const daysAvailable of [1, 2, 7, 40]) {
      const schedule = buildSchedule({ requirements, questions, daysAvailable });
      for (const day of schedule.days) {
        expect(Number.isInteger(day.minutes)).toBe(true);
        expect(day.minutes).toBeGreaterThan(0);
        expect(day.minutes).toBeLessThanOrEqual(MAX_DAY_MINUTES);
      }
    }

    const oneDay = buildSchedule({ requirements, questions, daysAvailable: 1 });
    expect(oneDay.days[0].minutes).toBe(MAX_DAY_MINUTES);

    const spread = buildSchedule({ requirements, questions, daysAvailable: 40 });
    expect(spread.days[0].minutes).toBe(MINUTES_PER_QUESTION);
  });

  it('describes each day by what is on it', () => {
    const requirements = [makeRequirement('r1')];
    const questions = [
      makeQuestion('q1', { requirement_ids: ['r1'], category: 'system-design' }),
      makeQuestion('q2', { requirement_ids: ['r1'], category: 'company-fit' }),
    ];
    const schedule = buildSchedule({ requirements, questions, daysAvailable: 2 });

    expect(schedule.days[0].focus).toBe('System design');
    expect(schedule.days[1].focus).toBe('Company fit');

    const together = buildSchedule({ requirements, questions, daysAvailable: 1 });
    expect(together.days[0].focus).toBe('System design and company fit');
  });

  it('produces honest empty days when the kit has no questions', () => {
    const schedule = buildSchedule({ requirements: [makeRequirement('r1')], daysAvailable: 3 });

    expect(schedule.days).toHaveLength(3);
    for (const day of schedule.days) {
      expect(day.question_ids).toEqual([]);
      expect(day.minutes).toBe(0);
      expect(day.focus).toBe('No questions in this kit yet');
    }
  });

  it('never lists the same question twice on one day', () => {
    const { requirements, questions } = bank(3);

    for (let daysAvailable = 1; daysAvailable <= 20; daysAvailable += 1) {
      const schedule = buildSchedule({ requirements, questions, daysAvailable });
      for (const day of schedule.days) {
        expect(new Set(day.question_ids).size).toBe(day.question_ids.length);
      }
    }
  });

  it('rejects a day count that is not a whole number of at least one', () => {
    const { requirements, questions } = bank(4);

    for (const daysAvailable of [0, -1, 2.5, '5', undefined, Number.NaN]) {
      expect(() => buildSchedule({ requirements, questions, daysAvailable })).toThrow(TypeError);
    }
  });

  it('is deterministic and does not mutate its input', () => {
    const { requirements, questions } = bank(7);
    const before = structuredClone({ requirements, questions });

    const first = buildSchedule({ requirements, questions, daysAvailable: 4 });
    const second = buildSchedule({ requirements, questions, daysAvailable: 4 });

    expect(first).toEqual(second);
    expect({ requirements, questions }).toEqual(before);
  });

  it('produces a schedule the kit schema accepts', () => {
    const kit = makeKit();
    kit.schedule = buildSchedule({
      requirements: kit.role.requirements,
      questions: kit.questions,
      daysAvailable: 5,
    });

    const result = KitSchema.safeParse(kit);
    expect(result.success).toBe(true);
  });
});

describe('orderQuestions', () => {
  it('keeps the incoming order when priority and difficulty tie', () => {
    const requirements = [makeRequirement('r1')];
    const questions = makeQuestions(4, () => ({ requirement_ids: ['r1'], difficulty: 2 }));

    expect(orderQuestions(questions, requirements).map((q) => q.id)).toEqual([
      'q1',
      'q2',
      'q3',
      'q4',
    ]);
  });

  it('treats a question referencing an unknown requirement as a nice-to-have', () => {
    const requirements = [makeRequirement('r1', { priority: 'must' })];
    const questions = [
      makeQuestion('orphan', { requirement_ids: ['r9'], difficulty: 3 }),
      makeQuestion('real', { requirement_ids: ['r1'], difficulty: 1 }),
    ];

    expect(orderQuestions(questions, requirements).map((q) => q.id)).toEqual(['real', 'orphan']);
  });
});
