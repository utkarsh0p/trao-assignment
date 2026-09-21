/**
 * Turns the server's raw progress array into the fixed list of pipeline steps
 * the user watches.
 *
 * The server merges repeated reports on `step` + category/section
 * (backend/src/server/jobs/runner.js), so the client has to key on exactly the
 * same thing or the four per-category `generate` rows collapse into one.
 *
 * DESIGN.md's mock shows a "Hiring page" row. There is no such pipeline step,
 * and whether a company publishes a hiring page is not knowable until the kit
 * exists — so rather than invent a row, that fact is stated in the brief. The
 * skipped-and-not-a-failure idea the row was carrying lives here on the crawl
 * and scrape rows, which is where the pipeline actually reports it.
 */

export const QUESTION_CATEGORIES = [
  'technical',
  'behavioural',
  'system-design',
  'company-fit',
];

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

const STEPS = [
  {
    step: 'extract',
    label: 'Requirements extracted',
    detail: (d) => (d?.requirements != null ? plural(d.requirements, 'requirement') : null),
  },
  {
    step: 'crawl',
    label: 'Company site crawled',
    detail: (d, status) => {
      if (status === 'skipped') return 'not searched';
      if (status === 'failed') return 'site unreachable';
      return d?.links_considered ? `${d.links_considered} links ranked` : null;
    },
  },
  {
    step: 'scrape',
    label: 'Pages read',
    detail: (d, status) => {
      if (d?.pages) return plural(d.pages, 'page');
      if (status === 'skipped' || status === 'failed') return 'none readable';
      return null;
    },
  },
  {
    step: 'generate',
    label: 'Questions written',
    detail: (d) => {
      if (d?.questions == null) return null;
      const parts = [plural(d.questions, 'question')];
      if (d.flashcards != null) parts.push(plural(d.flashcards, 'flashcard'));
      return parts.join(', ');
    },
    children: QUESTION_CATEGORIES,
  },
  {
    step: 'coverage',
    label: 'Coverage check',
    detail: (d) => {
      if (d?.uncovered == null) return null;
      return d.uncovered === 0
        ? 'every must-have covered'
        : `${plural(d.uncovered, 'requirement')} still uncovered`;
    },
  },
  {
    step: 'schedule',
    label: 'Study schedule',
    detail: (d) => (d?.days != null ? plural(d.days, 'day') : null),
  },
];

const CATEGORY_LABEL = {
  technical: 'Technical',
  behavioural: 'Behavioural',
  'system-design': 'System design',
  'company-fit': 'Company fit',
};

/** The server's merge key, reproduced exactly. */
export function progressKey(step, detail) {
  return [step, detail?.category ?? detail?.section ?? ''].join(':');
}

function stateFor(entry) {
  if (!entry) return 'pending';
  switch (entry.status) {
    case 'done':
    case 'ok':
      return 'done';
    case 'started':
      return 'active';
    case 'skipped':
      return 'skipped';
    case 'failed':
      return 'failed';
    default:
      return 'active';
  }
}

/**
 * @param {Array<{step: string, status: string, detail?: object}>} progress
 * @returns {Array<{key: string, label: string, state: string, detail: string|null, children: Array}>}
 */
export function buildProgressRows(progress = []) {
  const byKey = new Map();
  for (const entry of progress) byKey.set(progressKey(entry.step, entry.detail), entry);

  return STEPS.map((spec) => {
    const entry = byKey.get(`${spec.step}:`);
    const state = stateFor(entry);

    const children = (spec.children || [])
      .map((category) => {
        const child = byKey.get(`${spec.step}:${category}`);
        if (!child) return null;
        return {
          key: `${spec.step}:${category}`,
          label: CATEGORY_LABEL[category] || category,
          state: stateFor(child),
          detail:
            child.detail?.questions != null ? plural(child.detail.questions, 'question') : null,
        };
      })
      .filter(Boolean);

    // A step whose children have started is itself under way, even if its own
    // "started" report has since been overwritten by a later one.
    const derived =
      state === 'pending' && children.some((c) => c.state !== 'pending') ? 'active' : state;

    return {
      key: `${spec.step}:`,
      label: spec.label,
      state: derived,
      detail: spec.detail?.(entry?.detail, entry?.status) ?? null,
      children,
    };
  });
}
