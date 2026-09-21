/**
 * "Same description and company submitted twice → the existing job is returned instead of running
 * again" (RULES.md). A kit costs a minute and a half of model time, so a double-submitted form, a
 * retried request, or an impatient second click must not buy two of them.
 *
 * The key is derived from the request rather than demanded from the client, so a plain form post
 * gets the protection without the frontend having to think about it. A client that knows better —
 * "this really is a second, separate kit for the same posting" — sends its own `Idempotency-Key`
 * and gets a new job.
 */
import { createHash } from 'node:crypto';

/**
 * Trailing slashes and casing in the host are not differences worth running a second job over;
 * a different path on the same site is.
 */
export function normaliseUrl(value) {
  try {
    const url = new URL(value);
    url.hash = '';
    url.hostname = url.hostname.toLowerCase();
    if (url.pathname !== '/' && url.pathname.endsWith('/')) url.pathname = url.pathname.slice(0, -1);
    return url.toString();
  } catch {
    return String(value).trim();
  }
}

/** Whitespace-insensitive: the same posting pasted twice is the same posting. */
const normaliseJd = (jd) => jd.replace(/\s+/g, ' ').trim();

export function idempotencyKey({ jd, company_url: companyUrl, days }, provided) {
  if (provided) return `client:${provided.slice(0, 200)}`;

  return createHash('sha256')
    .update([normaliseJd(jd), normaliseUrl(companyUrl), days].join(' '))
    .digest('hex');
}

export default idempotencyKey;
