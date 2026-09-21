/**
 * The kit contract.
 *
 * Field names are taken verbatim from docs/PROJECT.md -> "The kit structure". Nothing here may be
 * renamed or omitted. The cross-field rules at the bottom are what turn the three invariants in
 * that document into something a test can fail on.
 *
 * This module imports zod and nothing else. It must stay loadable with no .env present.
 */
import { z } from 'zod';

const Id = z.string().min(1);
const Text = z.string();

export const REQUIREMENT_KINDS = ['technical', 'behavioural', 'domain'];
export const REQUIREMENT_PRIORITIES = ['must', 'nice'];
export const QUESTION_CATEGORIES = ['technical', 'behavioural', 'system-design', 'company-fit'];
export const ORIGINS = ['generated', 'edited', 'pinned'];

/** Every generated item carries one of these. Regeneration replaces only `generated` items. */
const Origin = z.enum(ORIGINS).default('generated');

export const SourceSchema = z.object({
  company: Text,
  company_url: z.url(),
  role: Text,
  location: Text,
  jd_chars: z.number().int().min(0),
  researched_at: z.iso.datetime({ offset: true }),
  pages_used: z.array(z.url()),
  /** Honest record of anything that could not be done — an unreachable site, no hiring page. */
  notes: z.array(Text).default([]),
});

export const CompanyBriefSchema = z.object({
  summary: Text,
  what_they_do: Text,
  /**
   * What the company publishes about how it interviews, empty when it publishes nothing. An
   * extension to the structure in PROJECT.md, which permits them where they help: this is what
   * step 4 conditions its questions on, and regenerating a category needs it as much as the first
   * generation did. Keeping it in the kit means a regeneration does not have to crawl again to
   * ask the same question.
   */
  hiring_process: Text.default(''),
  sources: z.array(z.url()),
});

export const RequirementSchema = z.object({
  id: Id,
  text: Text,
  kind: z.enum(REQUIREMENT_KINDS),
  priority: z.enum(REQUIREMENT_PRIORITIES),
});

export const RoleSchema = z.object({
  title: Text,
  seniority: Text,
  responsibilities: z.array(Text),
  requirements: z.array(RequirementSchema),
});

export const QuestionSchema = z.object({
  id: Id,
  requirement_ids: z.array(Id),
  category: z.enum(QUESTION_CATEGORIES),
  prompt: Text,
  answer_outline: Text,
  difficulty: z.number().int().min(1).max(3),
  origin: Origin,
});

export const FlashcardSchema = z.object({
  id: Id,
  front: Text,
  back: Text,
  requirement_ids: z.array(Id),
  origin: Origin,
});

export const ScheduleDaySchema = z.object({
  day: z.number().int().min(1),
  focus: Text,
  question_ids: z.array(Id),
  /** Integer minutes. No floats, no "about an hour". */
  minutes: z.number().int().min(0),
});

export const ScheduleSchema = z.object({
  days_available: z.number().int().min(1),
  days: z.array(ScheduleDaySchema),
});

export const CoverageSchema = z.object({
  uncovered_requirement_ids: z.array(Id),
  passes: z.number().int().min(0),
});

const KitShape = z.object({
  source: SourceSchema,
  company_brief: CompanyBriefSchema,
  role: RoleSchema,
  questions: z.array(QuestionSchema),
  flashcards: z.array(FlashcardSchema),
  schedule: ScheduleSchema,
  coverage: CoverageSchema,
});

/** Reports the first duplicate value in `values`, or undefined. */
function findDuplicate(values) {
  const seen = new Set();
  for (let i = 0; i < values.length; i += 1) {
    if (seen.has(values[i])) return { value: values[i], index: i };
    seen.add(values[i]);
  }
  return undefined;
}

function checkUniqueIds(items, label, ctx, path) {
  const duplicate = findDuplicate(items.map((item) => item.id));
  if (duplicate) {
    ctx.addIssue({
      code: 'custom',
      path: [...path, duplicate.index, 'id'],
      message: `Duplicate ${label} id "${duplicate.value}".`,
    });
  }
}

function checkReferences(items, field, known, ctx, path, label) {
  items.forEach((item, index) => {
    item[field].forEach((ref, refIndex) => {
      if (!known.has(ref)) {
        ctx.addIssue({
          code: 'custom',
          path: [...path, index, field, refIndex],
          message: `${label} "${ref}" does not exist.`,
        });
      }
    });
  });
}

export const KitSchema = KitShape.superRefine((kit, ctx) => {
  const requirementIds = new Set(kit.role.requirements.map((r) => r.id));
  const questionIds = new Set(kit.questions.map((q) => q.id));

  checkUniqueIds(kit.role.requirements, 'requirement', ctx, ['role', 'requirements']);
  checkUniqueIds(kit.questions, 'question', ctx, ['questions']);
  checkUniqueIds(kit.flashcards, 'flashcard', ctx, ['flashcards']);

  // Every question and flashcard points at requirements that exist. This is what makes coverage
  // checkable rather than a matter of opinion.
  checkReferences(kit.questions, 'requirement_ids', requirementIds, ctx, ['questions'], 'Requirement');
  checkReferences(kit.flashcards, 'requirement_ids', requirementIds, ctx, ['flashcards'], 'Requirement');

  kit.coverage.uncovered_requirement_ids.forEach((ref, index) => {
    if (!requirementIds.has(ref)) {
      ctx.addIssue({
        code: 'custom',
        path: ['coverage', 'uncovered_requirement_ids', index],
        message: `Requirement "${ref}" does not exist.`,
      });
    }
  });

  // The schedule spans exactly the days asked for, numbered 1..N, with no gaps or repeats.
  const { days, days_available: daysAvailable } = kit.schedule;
  if (days.length !== daysAvailable) {
    ctx.addIssue({
      code: 'custom',
      path: ['schedule', 'days'],
      message: `Schedule has ${days.length} days but days_available is ${daysAvailable}.`,
    });
  } else {
    const expected = new Set(Array.from({ length: daysAvailable }, (_, i) => i + 1));
    days.forEach((day, index) => {
      if (!expected.delete(day.day)) {
        ctx.addIssue({
          code: 'custom',
          path: ['schedule', 'days', index, 'day'],
          message: `Day ${day.day} is out of range or repeated; expected each of 1..${daysAvailable} once.`,
        });
      }
    });
  }

  days.forEach((day, index) => {
    day.question_ids.forEach((ref, refIndex) => {
      if (!questionIds.has(ref)) {
        ctx.addIssue({
          code: 'custom',
          path: ['schedule', 'days', index, 'question_ids', refIndex],
          message: `Question "${ref}" does not exist.`,
        });
      }
    });
  });
});

export default KitSchema;
