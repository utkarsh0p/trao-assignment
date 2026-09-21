/**
 * A deterministic stand-in for the model.
 *
 * Same interface as the Groq client, no key and no network. It is not a recorded transcript: it
 * reads the requirement ids out of the prompt it was given and answers about those, so the
 * coverage loop is genuinely exercised — a gap the pipeline reports is a gap the next call
 * actually fills. Tests that want a gap that stays open say so with `neverCover`.
 *
 * Lives in llm/ rather than tests/ because the batch command uses it too: it is what lets the
 * whole pipeline be run end to end when no key is available.
 */

/** Which category is expected to carry a requirement of each kind. Mirrors generateKit. */
const CATEGORY_FOR_KIND = {
  technical: 'technical',
  behavioural: 'behavioural',
  domain: 'technical',
};

const REQUIREMENT_LINE = /^(r\d+) \[(must|nice), (technical|behavioural|domain)\] (.+)$/gm;

/** The requirements the prompt actually contains, in the form the prompt formats them. */
export function readRequirements(user) {
  return [...user.matchAll(REQUIREMENT_LINE)].map(([, id, priority, kind, text]) => ({
    id,
    priority,
    kind,
    text: text.trim(),
  }));
}

const DEFAULT_EXTRACT = {
  title: 'Senior Backend Engineer',
  seniority: 'senior',
  location: 'Remote (UK)',
  responsibilities: ['Own the billing service', 'Mentor two junior engineers'],
  requirements: [
    { text: '5+ years building services in Node', kind: 'technical', priority: 'must' },
    { text: 'Designing systems for scale', kind: 'technical', priority: 'must' },
    { text: 'Mentoring junior engineers', kind: 'behavioural', priority: 'must' },
    { text: 'Payments or billing domain experience', kind: 'domain', priority: 'nice' },
  ],
};

const DEFAULT_BRIEF = {
  summary: 'Acme sells billing infrastructure to other software companies.',
  what_they_do: 'A hosted billing and metering API.',
  hiring_process: 'A take-home exercise, then a system design round, then a values interview.',
};

/**
 * @param {{
 *   extract?: object,              replaces the extraction reply
 *   brief?: object,                replaces the company brief reply
 *   neverCover?: string[],         requirement ids no call will ever write a question for
 *   questionsPerRequirement?: number,
 *   handlers?: Record<string, Function>,   purpose (or its prefix) -> (call) => data
 *   fail?: (call) => Error | undefined,
 * }} script
 */
export function createFakeClient(script = {}) {
  const {
    extract = DEFAULT_EXTRACT,
    brief = DEFAULT_BRIEF,
    neverCover = [],
    handlers = {},
    fail,
  } = script;

  const calls = [];
  const uncoverable = new Set(neverCover);

  function questionsFor(user, category) {
    const requirements = readRequirements(user).filter((r) => !uncoverable.has(r.id));

    // A category answers for the requirements whose kind it is responsible for. The two categories
    // that belong to no kind in particular answer once, against the first requirement they see.
    const mine = requirements.filter((r) => CATEGORY_FOR_KIND[r.kind] === category);
    const chosen = mine.length > 0 ? mine : requirements.slice(0, 1);

    return {
      questions: chosen.map((requirement, index) => ({
        requirement_ids: [requirement.id],
        prompt: `[${category}] Tell me about ${requirement.text.toLowerCase()}.`,
        answer_outline: `A specific example, the decision made, the outcome. (${requirement.id})`,
        difficulty: (index % 3) + 1,
      })),
    };
  }

  function respond(call) {
    const { purpose, user } = call;

    for (const [prefix, handler] of Object.entries(handlers)) {
      if (purpose === prefix || purpose.startsWith(prefix)) return handler(call);
    }

    if (purpose === 'extract-requirements') return extract;

    if (purpose === 'shortlist-links') {
      // The candidates arrive already ranked by the heuristic, so a stand-in that takes the top
      // few is a fair model of a sensible choice — and it keeps the crawl deterministic.
      const want = Number(user.match(/Choose up to (\d+)/)?.[1] ?? 3);
      const numbers = [...user.matchAll(/^(\d+)\. https?:\/\//gm)].map(([, n]) => Number(n));
      return { choices: numbers.slice(0, want).map((number) => ({ number, why: 'ranked highly' })) };
    }
    if (purpose === 'company-brief') return brief;

    if (purpose.startsWith('questions:')) {
      return questionsFor(user, purpose.slice('questions:'.length));
    }

    if (purpose.startsWith('fill-gaps:')) {
      // The gap prompt contains only the uncovered requirements, so answering everything it lists
      // is exactly the behaviour a second pass is supposed to have.
      const [, category] = purpose.split(':');
      const gaps = readRequirements(user).filter((r) => !uncoverable.has(r.id));
      return {
        questions: gaps.map((requirement) => ({
          requirement_ids: [requirement.id],
          prompt: `[${category}, follow-up] What would you do about ${requirement.text.toLowerCase()}?`,
          answer_outline: `The gap-filling answer for ${requirement.id}.`,
          difficulty: 2,
        })),
      };
    }

    if (purpose === 'flashcards') {
      return {
        flashcards: readRequirements(user).map((requirement) => ({
          front: `${requirement.text}?`,
          back: `What to say about ${requirement.text.toLowerCase()}.`,
          requirement_ids: [requirement.id],
        })),
      };
    }

    throw new Error(`fake client has no answer for purpose "${purpose}".`);
  }

  return {
    name: 'fake',
    model: 'fake',
    calls,

    async json(call) {
      calls.push({ purpose: call.purpose, user: call.user, system: call.system });

      const failure = fail?.(call);
      if (failure) throw failure;

      // Validated against the caller's own schema, so a fake that drifts from the real contract
      // fails here rather than quietly producing a kit no real reply could produce.
      return call.schema.parse(respond(call));
    },
  };
}

/** Purposes called, in order — what a test asserts the sequencing against. */
export const purposesOf = (client) => client.calls.map((call) => call.purpose);

export default createFakeClient;
