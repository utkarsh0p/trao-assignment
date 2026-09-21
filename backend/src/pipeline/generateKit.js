/**
 * generateKit() — the whole pipeline, and the only thing the API and the CLI have in common.
 *
 * Pure in the sense that matters: no database, no auth, no req/res, no process.env. Everything it
 * needs arrives as an argument, including the model client and the research collaborator, so the
 * batch command can run it with nothing but an LLM key and a test can run it with neither.
 *
 * The six steps, from PROJECT.md:
 *
 *   1 extract   LLM    the job description becomes requirements with stable ids
 *   2 crawl     code + LLM   rank the company's links, shortlist what to read
 *   3 scrape    code   chosen pages become clean text
 *   4 generate  LLM    questions, one category at a time, then flashcards
 *   5 coverage  CODE   which requirements have no question — loops back into 4
 *   6 schedule  CODE   the material across exactly the days available
 *
 * Steps 5 and 6 are never asked of the model. Step 4 responds to what steps 2 and 3 actually
 * found: a company that publishes its hiring process produces a different kit from one that says
 * nothing, and a company we could not reach produces an honest kit built from the posting alone.
 */
import { KitSchema } from '../schema/kit.js';
import { checkCoverage } from './coverage.js';
import { extractRequirements } from './extract.js';
import {
  GENERATED_CATEGORIES,
  generateBrief,
  generateFlashcards,
  generateGapQuestions,
  generateQuestionsForCategory,
} from './generate.js';
import { buildSchedule } from './schedule.js';

/**
 * Coverage checks per kit, including the first. Three is the cap because the first fill pass
 * closes almost every gap, the second catches requirements the model reworded rather than covered,
 * and a third has never been observed to add one — past that it is spending tokens to re-ask a
 * question the posting does not support.
 */
export const MAX_COVERAGE_PASSES = 3;

/** Which category a missing requirement gets its question from, by the kind it was extracted as. */
const CATEGORY_FOR_KIND = {
  technical: 'technical',
  behavioural: 'behavioural',
  domain: 'technical',
};

/**
 * Retrieval is injected. Until the crawler lands this is the default, and it stays the default for
 * any caller that does not want the network — it produces a kit from the posting alone and says so.
 */
export async function skipResearch() {
  return {
    status: 'skipped',
    pages: [],
    links_considered: 0,
    notes: ['Company research did not run, so this kit is based on the job description alone.'],
  };
}

/** "https://www.acme-labs.example/careers" -> "Acme Labs". A placeholder until a page names them. */
export function companyNameFromUrl(companyUrl) {
  try {
    const { hostname } = new URL(companyUrl);
    const label = hostname.replace(/^www\./i, '').split('.')[0] ?? '';
    return label
      .split(/[-_]/)
      .filter(Boolean)
      .map((word) => word[0].toUpperCase() + word.slice(1))
      .join(' ');
  } catch {
    return '';
  }
}

/**
 * @param {{
 *   jd: string,
 *   company_url: string,
 *   days: number,
 *   client: {json: Function},
 *   research?: Function,
 *   onProgress?: (event: {step: string, status: string, detail?: object}) => void,
 *   now?: () => Date,
 * }} input
 * @returns {Promise<object>} a kit that has been validated against KitSchema.
 */
export async function generateKit({
  jd,
  company_url: companyUrl,
  days,
  client,
  research = skipResearch,
  onProgress,
  now = () => new Date(),
}) {
  const report = makeReporter(onProgress);
  const notes = [];

  // ── 1. Extract ────────────────────────────────────────────────────────────────────────────
  report('extract', 'started');
  const extracted = await extractRequirements({ jd, client });
  const { role, location } = extracted;
  const { requirements } = role;
  notes.push(...extracted.notes);
  report('extract', 'done', { requirements: requirements.length });

  // ── 2 & 3. Crawl and scrape ───────────────────────────────────────────────────────────────
  // An unreachable site is a gap carried forward, never an aborted run.
  report('crawl', 'started');
  const retrieval = await research({ companyUrl, client, report });
  report('crawl', retrieval.status, { links_considered: retrieval.links_considered ?? 0 });
  report('scrape', retrieval.pages.length > 0 ? 'done' : retrieval.status, {
    pages: retrieval.pages.length,
  });
  notes.push(...(retrieval.notes ?? []));

  // ── 4. Generate ───────────────────────────────────────────────────────────────────────────
  report('generate', 'started');
  const companyName = retrieval.company || companyNameFromUrl(companyUrl);
  const brief = await buildBrief({ client, companyName, companyUrl, retrieval, notes });

  const questions = [];
  const addQuestions = (items) => {
    for (const item of items) questions.push({ ...item, id: `q${questions.length + 1}` });
  };

  if (requirements.length > 0) {
    for (const category of GENERATED_CATEGORIES) {
      report('generate', 'started', { category });
      try {
        const produced = await generateQuestionsForCategory({
          client,
          category,
          role,
          requirements,
          brief: brief.what_they_do,
          hiringProcess: brief.hiring_process,
        });
        addQuestions(produced);
        // This category's own count, not the running total — a client showing
        // "16 questions" beside company-fit would be stating something untrue.
        report('generate', 'done', { category, questions: produced.length });
      } catch (error) {
        // One category the model could not produce is a gap, recorded and carried forward. The
        // coverage check below sees the shortfall and the kit reports it. Losing a whole kit
        // because one of four calls came back malformed would be the wrong trade.
        notes.push(`No ${category} questions could be generated (${reasonFor(error)}).`);
        report('generate', 'failed', { category });
      }
    }
  }

  // ── 5. Coverage — code only, and it loops back into 4 ─────────────────────────────────────
  report('coverage', 'started');
  let coverage = checkCoverage({ requirements, questions });
  let passes = 1;

  while (!coverage.complete && passes < MAX_COVERAGE_PASSES) {
    const gaps = requirements.filter((r) => coverage.uncovered_must_ids.includes(r.id));
    report('generate', 'started', { fillingGaps: gaps.map((r) => r.id), pass: passes + 1 });

    const before = questions.length;
    for (const [category, group] of groupByCategory(gaps)) {
      try {
        addQuestions(
          await generateGapQuestions({
            client,
            category,
            role,
            gaps: group,
            alreadyAsked: questions.map((q) => q.prompt),
            pass: passes + 1,
          }),
        );
      } catch {
        // A pass that fails leaves the gap open; the loop's own guard ends it, and the kit says
        // which requirements were never covered.
      }
    }

    passes += 1;
    coverage = checkCoverage({ requirements, questions });
    report('coverage', 'done', {
      pass: passes,
      added: questions.length - before,
      uncovered: coverage.uncovered_must_ids.length,
    });

    // Another pass can only repeat itself if the last one produced nothing.
    if (questions.length === before) break;
  }
  report('coverage', 'done', { passes, uncovered: coverage.uncovered_requirement_ids.length });

  if (coverage.uncovered_must_ids.length > 0) {
    notes.push(
      `After ${passes} coverage passes, ${coverage.uncovered_must_ids.length} required item${coverage.uncovered_must_ids.length === 1 ? ' has' : 's have'} no question: ${coverage.uncovered_must_ids.join(', ')}.`,
    );
  }

  let flashcards = [];
  if (requirements.length > 0) {
    try {
      flashcards = (await generateFlashcards({ client, role, requirements })).map((card, index) => ({
        ...card,
        id: `f${index + 1}`,
      }));
    } catch (error) {
      notes.push(`No flashcards could be generated (${reasonFor(error)}).`);
      report('generate', 'failed', { flashcards: 0 });
    }

    // An empty deck with nothing said about it is the kind of silent gap RULES.md forbids.
    if (flashcards.length === 0 && !notes.some((note) => note.startsWith('No flashcards'))) {
      notes.push('No flashcards could be generated from the model\'s reply, so this kit has none.');
    }
  }
  report('generate', 'done', { questions: questions.length, flashcards: flashcards.length });

  // ── 6. Schedule — code only ───────────────────────────────────────────────────────────────
  report('schedule', 'started');
  const schedule = buildSchedule({ requirements, questions, daysAvailable: days });
  report('schedule', 'done', { days: schedule.days.length });

  // Validated before it is returned, so neither caller can save or write out a malformed kit.
  return KitSchema.parse({
    source: {
      company: companyName,
      company_url: companyUrl,
      role: role.title,
      location,
      jd_chars: jd.length,
      researched_at: now().toISOString(),
      pages_used: retrieval.pages.map((page) => page.url),
      notes,
    },
    company_brief: {
      summary: brief.summary,
      what_they_do: brief.what_they_do,
      hiring_process: brief.hiring_process,
      sources: retrieval.pages.map((page) => page.url),
    },
    role,
    questions,
    flashcards,
    schedule,
    coverage: {
      uncovered_requirement_ids: coverage.uncovered_requirement_ids,
      passes,
    },
  });
}

/**
 * With pages, the model summarises them. Without, there is nothing to summarise and no call is
 * made — a brief about a company we could not read would be invention.
 */
export async function buildBrief({ client, companyName, companyUrl, retrieval, notes = [] }) {
  if (retrieval.pages.length === 0) {
    // No note here: retrieval has already recorded why it read nothing, and saying it twice in a
    // kit a person reads is worse than saying it once.
    return {
      summary: `No pages from ${companyUrl} could be read, so nothing here has been verified about ${companyName || 'this company'}.`,
      what_they_do: '',
      hiring_process: '',
    };
  }

  const brief = await generateBrief({ client, companyName, companyUrl, pages: retrieval.pages });
  if (!brief.hiring_process) {
    notes.push(
      'The company publishes nothing about how it interviews, so no assumptions have been made about their process.',
    );
  }
  return brief;
}

/** A short reason for a note a person will read, not a stack trace. */
function reasonFor(error) {
  if (error?.name === 'LlmOutputError') return 'the model did not return usable output';
  if (error?.name === 'LlmRequestError') return 'the model could not be reached';
  return error?.message ?? 'unknown error';
}

/** Gap requirements grouped by the category their kind calls for. At most one call per group. */
function groupByCategory(gaps) {
  const groups = new Map();
  for (const requirement of gaps) {
    const category = CATEGORY_FOR_KIND[requirement.kind] ?? 'technical';
    if (!groups.has(category)) groups.set(category, []);
    groups.get(category).push(requirement);
  }
  return groups;
}

/** Progress is a courtesy to the UI. A listener that throws must not take the kit down with it. */
function makeReporter(onProgress) {
  if (typeof onProgress !== 'function') return () => {};
  return (step, status, detail) => {
    try {
      onProgress({ step, status, ...(detail ? { detail } : {}) });
    } catch {
      /* ignored on purpose */
    }
  };
}

export default generateKit;
