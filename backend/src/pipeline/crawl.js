/**
 * Step 2 — find the pages worth reading, and read them.
 *
 * Paths are never hard-coded. RULES.md: "Companies bury hiring information in different places —
 * /careers, /jobs, a handbook, an engineering blog. The path cannot be guessed." So the crawl
 * follows links: score every link on the page by its address and its text, hand the best dozen to
 * the model, and fetch what it picks.
 *
 * The heuristic narrows; the model chooses; the code decides what is legal to fetch. The model
 * picks by number from a list we built — it can never hand back a URL of its own, because a URL is
 * an instruction to go and fetch something and that must not come from untrusted text.
 *
 * Two rounds, because one is not enough. A handbook index scores well and contains nothing useful;
 * the page it links to is the one that says how they interview. That is the Northwind fixture, and
 * it is the reason this is a crawl rather than a fetch.
 */
import * as cheerio from 'cheerio';
import { z } from 'zod';
import robotsParser from 'robots-parser';
import { requestJson } from '../llm/index.js';
import { listOf } from '../llm/shapes.js';
import { SHORTLIST_SYSTEM, shortlistUser } from '../llm/prompts.js';
import { PageFetchError, fetchPage } from './fetchPage.js';
import { scrapePage } from './scrape.js';

/** Pages actually fetched and kept, including the home page. */
export const MAX_PAGES = 6;

/** Links handed to the model in one round. More than this is noise, and tokens. */
export const MAX_CANDIDATES = 12;

export const USER_AGENT = 'PrepKitBot/1.0 (interview preparation; respects robots.txt)';

const SKIP_EXTENSIONS =
  /\.(pdf|zip|gz|tar|png|jpe?g|gif|webp|avif|svg|ico|css|js|mjs|json|xml|rss|atom|mp4|mp3|wav|woff2?|ttf|eot)$/i;

/**
 * What a link's address and text are worth. Hiring material first, then the pages that say who a
 * company is, then what they sell. Everything a candidate would not read is pushed down.
 */
const SIGNALS = [
  {
    weight: 10,
    pattern:
      /(careers?|jobs?|hiring|we-are-hiring|vacanc|joining|join-us|join-the|work-with-us|work-here|work-for-us|life-at|interview|how-we-hire|recruit|apply)/i,
  },
  { weight: 6, pattern: /(handbook|culture|values|our-team|the-team|people|who-we-are|about|mission|engineering)/i },
  { weight: 3, pattern: /(what-we-do|product|platform|services|solutions|customers|technology|blog|docs)/i },
];

const PENALTIES = [
  {
    weight: -9,
    pattern:
      /(privacy|terms|cookie|legal|gdpr|imprint|sitemap|rss|feed|login|log-in|sign-?in|sign-?up|register|cart|checkout|press|investor|newsroom|status|support|help-cent|pricing|contact)/i,
  },
];

const ShortlistReplySchema = listOf(
  'choices',
  z.object({ number: z.coerce.number().int().min(1), why: z.string().default('') }),
);

/** Strips the fragment and trailing noise so the same page is not fetched twice. */
function canonical(url) {
  const parsed = new URL(url);
  parsed.hash = '';
  parsed.search = '';
  return parsed.toString();
}

/**
 * Every link on the page, resolved against where the page actually came from — `new URL(href,
 * baseUrl)`, because a company site may be served from any host, including localhost.
 */
export function extractLinks(html, baseUrl) {
  const $ = cheerio.load(html);
  const origin = new URL(baseUrl).origin;
  const found = new Map();

  $('a[href]').each((_, element) => {
    const href = $(element).attr('href');
    if (!href || href.startsWith('#') || /^(mailto|tel|javascript):/i.test(href)) return;

    let url;
    try {
      url = canonical(new URL(href, baseUrl).toString());
    } catch {
      return;
    }

    // The company's own site only. An off-site link is somebody else's content.
    if (new URL(url).origin !== origin) return;
    if (SKIP_EXTENSIONS.test(new URL(url).pathname)) return;

    const text = $(element).text().trim().replace(/\s+/g, ' ').slice(0, 120);
    if (!found.has(url) || (!found.get(url).text && text)) found.set(url, { url, text });
  });

  return [...found.values()];
}

/** A link's score from its address and its text. Deeper paths are worth slightly less. */
export function scoreLink({ url, text }) {
  const { pathname } = new URL(url);
  const subject = decodeURIComponent(pathname).toLowerCase();
  // Link text is written for people — "How we hire", "Join us" — while a path is hyphenated.
  // Matching them against the same patterns means spelling the text the way a path is spelled.
  const label = (text ?? '').toLowerCase().replace(/\s+/g, '-');

  let score = 0;
  for (const { weight, pattern } of SIGNALS) {
    if (pattern.test(subject)) score += weight;
    if (pattern.test(label)) score += weight * 0.6;
  }
  for (const { weight, pattern } of PENALTIES) {
    if (pattern.test(subject) || pattern.test(label)) score += weight;
  }

  const depth = subject.split('/').filter(Boolean).length;
  return score - Math.max(0, depth - 2) * 0.5;
}

export function rankLinks(links, { exclude = new Set(), limit = MAX_CANDIDATES } = {}) {
  return links
    .filter((link) => !exclude.has(link.url))
    .map((link) => ({ ...link, score: scoreLink(link) }))
    .filter((link) => link.score > 0)
    .sort((a, b) => b.score - a.score || a.url.localeCompare(b.url))
    .slice(0, limit);
}

/** Fetches and parses robots.txt once per origin. A site with no robots.txt allows everything. */
async function loadRobots(origin, options) {
  const robotsUrl = new URL('/robots.txt', origin).toString();
  try {
    const { body } = await fetchPage(robotsUrl, options);
    return robotsParser(robotsUrl, body);
  } catch {
    // No robots.txt, or one we could not read, means nothing is disallowed. That is the standard
    // reading, and it is the permissive one, so it is stated rather than assumed.
    return null;
  }
}

/** The model picks from the numbered list. Anything it invents is discarded. */
async function shortlist({ client, companyUrl, candidates, want }) {
  if (candidates.length === 0) return [];
  if (!client) return candidates.slice(0, want);

  const reply = await requestJson(client, {
    purpose: 'shortlist-links',
    system: SHORTLIST_SYSTEM,
    user: shortlistUser({ companyUrl, links: candidates, want }),
    schema: ShortlistReplySchema,
    maxTokens: 512,
  });

  const picked = [];
  for (const choice of reply.choices) {
    const candidate = candidates[choice.number - 1];
    if (candidate && !picked.includes(candidate)) picked.push(candidate);
    if (picked.length === want) break;
  }
  return picked;
}

/** Why a page could not be read, in words that belong in a kit a person will read. */
function describeFetchError(error) {
  switch (error.code) {
    case 'HTTP_ERROR':
      return `it returned ${error.status}`;
    case 'TIMEOUT':
      return 'it did not answer in time';
    case 'BLOCKED_PRIVATE':
      return 'it points at a private address';
    case 'DNS_FAILED':
      return 'the host did not resolve';
    case 'NETWORK':
      return 'the host could not be reached';
    case 'UNSUPPORTED_TYPE':
      return 'it is not an HTML or text page';
    case 'TOO_LARGE':
      return 'the page is too large to read';
    case 'TOO_MANY_REDIRECTS':
      return 'it redirected too many times';
    case 'BAD_PROTOCOL':
    case 'INVALID_URL':
      return 'the address is not a fetchable URL';
    default:
      return 'it could not be read';
  }
}

/** The title of a site's home page, minus the tagline: "Acme Billing — metered…" -> "Acme Billing". */
function companyNameFromTitle(title) {
  return (title ?? '').split(/[—–|·:]/)[0].trim();
}

/**
 * The research collaborator `generateKit()` takes. Returns the pages it managed to read and an
 * honest note for everything it could not.
 *
 * @returns {Promise<{status: string, pages: object[], links_considered: number, notes: string[],
 *                    company?: string}>}
 */
export async function researchCompany({
  companyUrl,
  client,
  report = () => {},
  allowPrivateUrls = process.env.ALLOW_PRIVATE_URLS === 'true',
  maxPages = MAX_PAGES,
  fetchOptions = {},
}) {
  const options = { allowPrivateUrls, userAgent: USER_AGENT, ...fetchOptions };
  const notes = [];
  const pages = [];
  const visited = new Set();
  let linksConsidered = 0;
  let company;

  const robots = await loadRobots(new URL(companyUrl).origin, options);
  const allowed = (url) => (robots ? robots.isAllowed(url, USER_AGENT) !== false : true);

  /**
   * Fetches one page. `quiet` returns the failure instead of noting it, which is what the home
   * page needs — one note explaining the whole site is unreachable reads better than two.
   */
  async function read(url, { quiet = false } = {}) {
    const key = canonical(url);
    if (visited.has(key) || pages.length >= maxPages) return null;
    visited.add(key);

    if (!allowed(key)) {
      notes.push(`${key} was not read: the site's robots.txt disallows it.`);
      return null;
    }

    try {
      const response = await fetchPage(key, options);
      const page = scrapePage(response);
      pages.push(page);
      return { page, html: response.body, url: response.url };
    } catch (error) {
      if (error instanceof PageFetchError) {
        if (!quiet) notes.push(`${key} could not be read — ${describeFetchError(error)}.`);
        return { error };
      }
      throw error;
    }
  }

  // ── The home page. Without it there is nothing to crawl. ────────────────────────────────
  const home = await read(companyUrl, { quiet: true });
  if (!home?.page) {
    const reason = home?.error ? describeFetchError(home.error) : 'it could not be read';
    return {
      status: 'failed',
      pages: [],
      links_considered: 0,
      notes: [
        `${companyUrl} could not be reached — ${reason}. This kit is based on the job description alone.`,
        ...notes,
      ],
    };
  }

  company = companyNameFromTitle(home.page.title);
  report('crawl', 'started', { url: home.url });

  // ── Round one: the home page's links. ───────────────────────────────────────────────────
  let frontier = [home];
  for (let round = 1; round <= 2 && pages.length < maxPages; round += 1) {
    const links = frontier.flatMap((source) => extractLinks(source.html, source.url));
    const candidates = rankLinks(links, { exclude: visited });
    linksConsidered += links.length;
    if (candidates.length === 0) break;

    const want = Math.min(round === 1 ? 3 : 2, maxPages - pages.length);
    const picked = await shortlist({ client, companyUrl, candidates, want });
    report('crawl', 'done', { round, considered: candidates.length, picked: picked.length });

    const next = [];
    for (const candidate of picked) {
      const result = await read(candidate.url);
      if (result?.page) next.push(result);
    }
    if (next.length === 0) break;
    frontier = next;
  }

  if (pages.length === 1) {
    notes.push(
      `Only the home page of ${companyUrl} could be read; nothing else on the site looked worth reading.`,
    );
  }

  return { status: 'ok', pages, links_considered: linksConsidered, notes, company };
}

/** Binds options once so `generateKit({ research })` receives the plain collaborator it expects. */
export function createResearch(defaults = {}) {
  return (input) => researchCompany({ ...defaults, ...input });
}

export default researchCompany;
