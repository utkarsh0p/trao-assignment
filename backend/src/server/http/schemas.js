/**
 * Request bodies. The kit contract itself lives in `src/schema/kit.js` and is not restated here —
 * these schemas describe what a client may *send*, which is deliberately narrower. A client can
 * edit a question's prompt; it cannot post an `id` or an `origin`, because those are the server's
 * to decide.
 */
import { z } from 'zod';
import { QUESTION_CATEGORIES } from '../../schema/kit.js';

const trimmed = z.string().trim();

export const RegisterBody = z.object({
  email: z.email().max(254),
  // Length is the only rule. A composition rule ("one capital, one symbol") narrows the search
  // space more than it widens it, and the brief does not ask for one.
  password: z.string().min(8).max(200),
  name: trimmed.max(80).default(''),
});

export const LoginBody = z.object({
  email: z.email().max(254),
  password: z.string().min(1).max(200),
});

/** 365 is a year out. Beyond that the schedule stops being a plan and starts being a calendar. */
export const DAYS_MAX = 365;

export const CreateKitBody = z.object({
  jd: trimmed.min(1, 'Paste the job description.').max(60_000),
  company_url: z.url('Give the company website as a full URL, including https://'),
  days: z.number().int().min(1).max(DAYS_MAX),
});

/** The batch upload: several description-and-company pairs at once. */
export const BatchKitsBody = z.object({
  items: z.array(CreateKitBody).min(1).max(20),
});

export const QuestionPatch = z
  .object({
    prompt: trimmed.min(1).max(2000),
    answer_outline: z.string().max(6000),
    category: z.enum(QUESTION_CATEGORIES),
    difficulty: z.number().int().min(1).max(3),
    requirement_ids: z.array(z.string().min(1)).max(20),
  })
  .partial()
  .refine((patch) => Object.keys(patch).length > 0, 'Nothing to change.');

export const NewQuestionBody = z.object({
  prompt: trimmed.min(1).max(2000),
  answer_outline: z.string().max(6000).default(''),
  category: z.enum(QUESTION_CATEGORIES),
  difficulty: z.number().int().min(1).max(3).default(2),
  requirement_ids: z.array(z.string().min(1)).max(20).default([]),
});

export const FlashcardPatch = z
  .object({
    front: trimmed.min(1).max(1000),
    back: z.string().max(4000),
    requirement_ids: z.array(z.string().min(1)).max(20),
  })
  .partial()
  .refine((patch) => Object.keys(patch).length > 0, 'Nothing to change.');

export const NewFlashcardBody = z.object({
  front: trimmed.min(1).max(1000),
  back: z.string().max(4000).default(''),
  requirement_ids: z.array(z.string().min(1)).max(20).default([]),
});

export const BriefPatch = z
  .object({
    summary: z.string().max(4000),
    what_they_do: z.string().max(4000),
  })
  .partial()
  .refine((patch) => Object.keys(patch).length > 0, 'Nothing to change.');

export const RolePatch = z
  .object({
    title: trimmed.min(1).max(200),
    seniority: z.string().max(80),
    responsibilities: z.array(z.string().max(1000)).max(50),
  })
  .partial()
  .refine((patch) => Object.keys(patch).length > 0, 'Nothing to change.');

export const ScheduleDayPatch = z
  .object({
    focus: trimmed.min(1).max(200),
    minutes: z.number().int().min(0).max(1440),
    question_ids: z.array(z.string().min(1)).max(200),
  })
  .partial()
  .refine((patch) => Object.keys(patch).length > 0, 'Nothing to change.');

/** A reorder is a permutation, so it is sent whole rather than as "move item 3 to index 7". */
export const ReorderBody = z.object({
  ids: z.array(z.string().min(1)).min(1).max(500),
});

export const PracticeBody = z.object({
  card_id: z.string().min(1),
  confidence: z.number().int().min(1).max(3),
});

export const REGENERATABLE_SECTIONS = ['brief', 'questions', 'flashcards', 'schedule'];

export const RegenerateBody = z.object({
  section: z.enum(REGENERATABLE_SECTIONS),
  /** Only for `questions`: regenerate one category and leave the other three alone. */
  category: z.enum(QUESTION_CATEGORIES).optional(),
});
