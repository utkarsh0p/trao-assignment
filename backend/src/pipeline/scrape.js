/**
 * Step 3 — a fetched page becomes clean text.
 *
 * Code only. No model involved: this is markup handling, and `html-to-text` does it.
 *
 * Two decisions worth stating. Navigation, footers and scripts are dropped, because every page on
 * a site repeats them and they crowd out the page's actual content in a prompt. And the text is
 * capped: a 200KB handbook page contributes its opening, not its entirety, because the prompt
 * budget is shared with three other pages and the job description.
 */
import * as cheerio from 'cheerio';
import { convert } from 'html-to-text';

/** Per page. Enough for a careers page or an about page in full, with room for three more. */
export const MAX_TEXT_CHARS = 6000;

const CONVERT_OPTIONS = {
  wordwrap: false,
  selectors: [
    // Chrome that repeats on every page and tells a reader nothing about this one.
    { selector: 'nav', format: 'skip' },
    { selector: 'header', format: 'skip' },
    { selector: 'footer', format: 'skip' },
    { selector: 'script', format: 'skip' },
    { selector: 'style', format: 'skip' },
    { selector: 'noscript', format: 'skip' },
    { selector: 'svg', format: 'skip' },
    { selector: 'form', format: 'skip' },
    { selector: 'img', format: 'skip' },
    // Links keep their text and lose their href — the URL is noise inside a prompt.
    { selector: 'a', options: { ignoreHref: true } },
  ],
};

/** Cuts at a sentence or a word rather than mid-syllable, and says that it cut. */
function cap(text, maxChars) {
  if (text.length <= maxChars) return text;
  const head = text.slice(0, maxChars);
  const cut = Math.max(head.lastIndexOf('. '), head.lastIndexOf('\n'));
  return `${head.slice(0, cut > maxChars * 0.6 ? cut + 1 : maxChars).trimEnd()}\n[truncated]`;
}

/**
 * @param {{url: string, body: string, contentType?: string}} page
 * @returns {{url: string, title: string, text: string}} ready to go inside a <page> tag.
 */
export function scrapePage({ url, body, contentType = 'text/html' }, { maxChars = MAX_TEXT_CHARS } = {}) {
  if (contentType.startsWith('text/plain')) {
    return { url, title: '', text: cap(body.trim().replace(/\n{3,}/g, '\n\n'), maxChars) };
  }

  const $ = cheerio.load(body);
  const title = ($('title').first().text() || $('h1').first().text() || '').trim();
  const text = convert($.html(), CONVERT_OPTIONS)
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  return { url, title, text: cap(text, maxChars) };
}

export default scrapePage;
