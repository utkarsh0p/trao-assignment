/**
 * Regenerating one section of a kit without losing the rest of it.
 *
 * The rule is the one in PROJECT.md: regeneration replaces only `generated` items. A question the
 * user edited is `edited`, one they wrote is `pinned`, and both survive — so "regenerate the
 * behavioural questions" means "replace the four the model wrote, keep the two I rewrote".
 *
 * This runs the same generation functions the pipeline runs. It does not reimplement them, and it
 * does not decide coverage or the schedule: those come back through `finalise()` in `edit.js`.
 */
import {
  generateFlashcards,
  generateQuestionsForCategory,
} from '../../pipeline/generate.js';
import { buildSchedule } from '../../pipeline/schedule.js';
import { buildBrief, companyNameFromUrl } from '../../pipeline/generateKit.js';
import { QUESTION_CATEGORIES } from '../../schema/kit.js';
import { badRequest } from '../http/errors.js';
import { finalise, nextId } from './edit.js';

/**
 * Every note generateKit writes about a missing deck starts this way, and so does the one below.
 * A successful regeneration drops them, because a kit with twelve cards must not still carry a
 * line saying it has none.
 */
const EMPTY_DECK_PREFIX = 'No flashcards';
const EMPTY_DECK_NOTE = 'No flashcards could be generated, so this kit has none.';

const keepsSurvivors = (items) => items.filter((item) => item.origin !== 'generated');

/**
 * A regeneration that the model could not answer is a generation failure, not a bad request — the
 * job runner reads the name to give it the same code the batch command would.
 */
function asGenerationFailure(cause, message) {
  const error = new Error(cause ? `${message} (${cause.message})` : message, { cause });
  error.name = cause?.name?.startsWith('Llm') ? cause.name : 'LlmOutputError';
  return error;
}

/**
 * @param {{kit: object, section: string, category?: string, client: object, research?: Function,
 *          report?: Function, now?: () => Date}} input
 * @returns {Promise<object>} a new, validated kit. The original is not mutated.
 */
export async function regenerateSection({
  kit,
  section,
  category,
  client,
  research,
  report = () => {},
  now = () => new Date(),
}) {
  const draft = structuredClone(kit);

  if (section === 'brief') return regenerateBrief({ draft, client, research, report, now });
  if (section === 'questions') return regenerateQuestions({ draft, category, client, report });
  if (section === 'flashcards') return regenerateFlashcards({ draft, client, report });
  if (section === 'schedule') return regenerateSchedule({ draft, report });

  throw badRequest(`"${section}" is not a section that can be regenerated.`);
}

/**
 * The brief is the one section that needs the network: it is a summary of pages, so regenerating
 * it means reading the site again. Whatever that second visit finds is what the kit then says —
 * including the notes, which describe the run that produced the brief now in front of the user.
 * Carrying forward "the site was unreachable" after a successful re-crawl would be a lie.
 */
async function regenerateBrief({ draft, client, research, report, now }) {
  if (typeof research !== 'function') {
    throw badRequest('The company brief cannot be regenerated without retrieval configured.');
  }

  report('crawl', 'started');
  const companyUrl = draft.source.company_url;
  const retrieval = await research({ companyUrl, client, report });
  report('crawl', retrieval.status, { links_considered: retrieval.links_considered ?? 0 });

  const notes = [...(retrieval.notes ?? [])];
  const companyName = retrieval.company || draft.source.company || companyNameFromUrl(companyUrl);
  const brief = await buildBrief({ client, companyName, companyUrl, retrieval, notes });

  const pages = retrieval.pages.map((page) => page.url);
  draft.company_brief = {
    summary: brief.summary,
    what_they_do: brief.what_they_do,
    hiring_process: brief.hiring_process,
    sources: pages,
  };
  draft.source = {
    ...draft.source,
    company: companyName || draft.source.company,
    pages_used: pages,
    researched_at: now().toISOString(),
    notes,
  };

  // The deck being empty is a fact about the kit, not about this run, so it is re-stated here
  // rather than lost with the notes it was written alongside.
  if (draft.flashcards.length === 0) draft.source.notes.push(EMPTY_DECK_NOTE);

  report('generate', 'done', { section: 'brief' });
  return finalise(draft);
}

/**
 * One category, or all four. Survivors keep their ids — a practice record or a schedule entry
 * pointing at `q3` must still mean the same question afterwards — so new questions are numbered
 * from the highest id the kit has ever used.
 */
async function regenerateQuestions({ draft, category, client, report }) {
  const categories = category ? [category] : QUESTION_CATEGORIES;
  const { requirements } = draft.role;

  if (requirements.length === 0) {
    throw badRequest('This kit has no requirements, so there is nothing to write questions about.');
  }

  const survivors = draft.questions.filter(
    (question) => question.origin !== 'generated' || !categories.includes(question.category),
  );

  const produced = [];
  const failures = [];
  let firstFailure;
  for (const target of categories) {
    report('generate', 'started', { category: target });
    try {
      const questions = await generateQuestionsForCategory({
        client,
        category: target,
        role: draft.role,
        requirements,
        brief: draft.company_brief.what_they_do,
        hiringProcess: draft.company_brief.hiring_process ?? '',
      });
      produced.push(...questions);
      report('generate', 'done', { category: target, questions: questions.length });
    } catch (error) {
      failures.push(target);
      firstFailure ??= error;
      report('generate', 'failed', { category: target });
    }
  }

  // Every requested category failing means the user got nothing; their kit is left untouched and
  // the model's own failure is what gets reported, rather than a section quietly emptied out.
  if (produced.length === 0 && failures.length === categories.length) {
    throw asGenerationFailure(
      firstFailure,
      `No ${categories.join(', ')} questions could be produced. The kit is unchanged — try again.`,
    );
  }

  // The high-water mark is taken from the bank *before* the replaced questions were dropped, so a
  // new question never inherits the id of one this kit has already used for something else.
  const used = draft.questions.map((question) => ({ id: question.id }));
  draft.questions = survivors;

  const placed = [];
  for (const question of produced) {
    const id = nextId('q', [...used, ...draft.questions]);
    used.push({ id });
    draft.questions.push({ ...question, id });
    placed.push(id);
  }

  return finalise(draft, { place: placed });
}

async function regenerateFlashcards({ draft, client, report }) {
  const { requirements } = draft.role;
  if (requirements.length === 0) {
    throw badRequest('This kit has no requirements, so there is nothing to make cards from.');
  }

  report('generate', 'started', { section: 'flashcards' });
  const cards = await generateFlashcards({ client, role: draft.role, requirements });
  if (cards.length === 0) {
    throw asGenerationFailure(undefined, 'The model returned no flashcards. The kit is unchanged.');
  }

  const used = draft.flashcards.map((card) => ({ id: card.id }));
  draft.flashcards = keepsSurvivors(draft.flashcards);
  for (const card of cards) {
    // Same rule as questions, and it matters more here: a practice record is keyed by card id.
    const id = nextId('f', [...used, ...draft.flashcards]);
    used.push({ id });
    draft.flashcards.push({ ...card, id });
  }

  draft.source.notes = draft.source.notes.filter((note) => !note.startsWith(EMPTY_DECK_PREFIX));
  report('generate', 'done', { section: 'flashcards', flashcards: draft.flashcards.length });
  return finalise(draft);
}

/**
 * No model involved — the schedule is arithmetic (RULES.md), so regenerating it is just running
 * the allocator again over whatever the question bank now holds. It is also the repair for a
 * schedule the user has edited into a shape they no longer want.
 */
function regenerateSchedule({ draft, report }) {
  report('schedule', 'started');
  draft.schedule = buildSchedule({
    requirements: draft.role.requirements,
    questions: draft.questions,
    daysAvailable: draft.schedule.days_available,
  });
  report('schedule', 'done', { days: draft.schedule.days.length });
  return finalise(draft);
}

export default regenerateSection;
