/**
 * Step 4 — requirements become questions, flashcards and the company brief.
 *
 * One call per category, deliberately. PROJECT.md: "A requirement like 'five years of React' leads
 * to technical questions; 'mentoring junior engineers' leads to behavioural ones. Those must not
 * come from the same call with the same instructions."
 *
 * Nothing here decides coverage or ordering — it only produces items. Ids are assigned by the
 * orchestrator so that one place owns id policy. Every item comes back with `origin: 'generated'`,
 * which is what lets a later regeneration replace it while leaving edited and pinned items alone.
 */
import { z } from 'zod';
import { requestJson } from '../llm/index.js';
import {
  BRIEF_SYSTEM,
  FLASHCARDS_SYSTEM,
  QUESTIONS_SYSTEM,
  briefUser,
  fillGapsUser,
  flashcardsUser,
  questionsUser,
} from '../llm/prompts.js';
import { listOf, looseString, stringArray } from '../llm/shapes.js';
import { QUESTION_CATEGORIES } from '../schema/kit.js';

const QuestionsReplySchema = listOf(
  'questions',
  z.object({
    requirement_ids: stringArray.default([]),
    prompt: z.string().min(1),
    answer_outline: looseString.default(''),
    difficulty: z.coerce.number().int().min(1).max(3).catch(2),
  }),
);

const FlashcardsReplySchema = listOf(
  'flashcards',
  z.object({
    front: z.string().min(1),
    back: looseString.default(''),
    requirement_ids: stringArray.default([]),
  }),
);

const BriefReplySchema = z.object({
  summary: looseString.default(''),
  what_they_do: looseString.default(''),
  hiring_process: looseString.default(''),
});

/** How many questions to ask for per category, given how much the posting actually gave us. */
export function questionsPerCategory(requirementCount) {
  return Math.min(5, Math.max(2, Math.ceil(requirementCount / 2)));
}

/**
 * Drops references to requirements that do not exist, then drops any item left covering nothing.
 * A question that cannot be traced to a requirement is invisible to the coverage check, so it
 * would be dead weight in the kit.
 */
function keepResolvable(items, knownIds) {
  const kept = [];
  for (const item of items) {
    const requirementIds = [...new Set(item.requirement_ids)].filter((id) => knownIds.has(id));
    if (requirementIds.length > 0) kept.push({ ...item, requirement_ids: requirementIds });
  }
  return kept;
}

const knownIdsOf = (requirements) => new Set(requirements.map((r) => r.id));

/** Questions for one category. Returns items with no ids — the orchestrator numbers them. */
export async function generateQuestionsForCategory({
  client,
  category,
  role,
  requirements,
  brief = '',
  hiringProcess = '',
  count = questionsPerCategory(requirements.length),
}) {
  const reply = await requestJson(client, {
    purpose: `questions:${category}`,
    system: QUESTIONS_SYSTEM,
    user: questionsUser({ category, count, role, requirements, brief, hiringProcess }),
    schema: QuestionsReplySchema,
    temperature: 0.4,
    // Five questions with three-line outlines is well under this. The reservation is what the
    // provider charges against the per-minute budget, so a generous one slows the whole run.
    maxTokens: 1800,
  });

  return keepResolvable(reply.questions, knownIdsOf(requirements)).map((question) => ({
    ...question,
    category,
    origin: 'generated',
  }));
}

/**
 * The second half of the coverage loop: questions for requirements that nothing covers yet.
 * `gaps` is a subset of `requirements`, so the model is shown only what is missing.
 */
export async function generateGapQuestions({
  client,
  category,
  role,
  gaps,
  alreadyAsked = [],
  pass = 2,
}) {
  const reply = await requestJson(client, {
    purpose: `fill-gaps:${category}:pass-${pass}`,
    system: QUESTIONS_SYSTEM,
    user: fillGapsUser({ category, role, requirements: gaps, alreadyAsked }),
    schema: QuestionsReplySchema,
    temperature: 0.4,
    maxTokens: 1800,
  });

  return keepResolvable(reply.questions, knownIdsOf(gaps)).map((question) => ({
    ...question,
    category,
    origin: 'generated',
  }));
}

export async function generateFlashcards({ client, role, requirements, count }) {
  const reply = await requestJson(client, {
    purpose: 'flashcards',
    system: FLASHCARDS_SYSTEM,
    user: flashcardsUser({ count: count ?? Math.min(20, Math.max(4, requirements.length * 2)), role, requirements }),
    schema: FlashcardsReplySchema,
    temperature: 0.4,
    maxTokens: 1800,
  });

  return keepResolvable(reply.flashcards, knownIdsOf(requirements)).map((card) => ({
    ...card,
    origin: 'generated',
  }));
}

/**
 * The company brief, from the pages retrieval actually reached. With no pages there is nothing to
 * summarise and no call is made — an honest empty brief is the orchestrator's job, not the model's.
 */
export async function generateBrief({ client, companyName, companyUrl, pages }) {
  return requestJson(client, {
    purpose: 'company-brief',
    system: BRIEF_SYSTEM,
    user: briefUser({ companyName, companyUrl, pages }),
    schema: BriefReplySchema,
    maxTokens: 800,
  });
}

/** The categories generated, in the order they are generated. */
export const GENERATED_CATEGORIES = QUESTION_CATEGORIES;

export default generateQuestionsForCategory;
