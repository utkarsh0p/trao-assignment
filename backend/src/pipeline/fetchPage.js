/**
 * One page, fetched safely.
 *
 * This is the only place in the pipeline that touches the open internet, and everything it brings
 * back is untrusted. RULES.md -> Security asks for three things, and they are all here:
 *
 *   - private and loopback addresses are rejected unless ALLOW_PRIVATE_URLS says otherwise
 *   - only HTML and plain text, only up to a size cap, only within a timeout
 *   - what comes back is content. Nothing here interprets it.
 *
 * The guard resolves the hostname before fetching rather than pattern-matching it, because
 * `db.internal.example` is a perfectly innocent-looking name that can resolve to 10.0.0.5. DNS is
 * the one piece of I/O beyond fetch that this module does, and it is injectable so tests do not
 * need a resolver.
 *
 * Redirects are followed by hand. A redirect is a second URL, chosen by the site rather than by
 * us, so it gets checked exactly like the first one.
 */
import { lookup as dnsLookup } from 'node:dns/promises';

export const DEFAULT_TIMEOUT_MS = 10_000;
export const DEFAULT_MAX_BYTES = 2_000_000;
export const MAX_REDIRECTS = 3;

/** Named so the crawler can record why a page was skipped, in words a user can read. */
export class PageFetchError extends Error {
  constructor(code, message, { url, status, cause } = {}) {
    super(message, { cause });
    this.name = 'PageFetchError';
    this.code = code;
    this.url = url;
    this.status = status;
  }
}

const ALLOWED_TYPES = ['text/html', 'text/plain', 'application/xhtml+xml'];

const v4 = (address) => address.split('.').map(Number);

/**
 * Loopback, private, link-local, carrier-grade NAT, multicast and reserved space. The one that
 * matters most in a cloud deployment is 169.254.169.254 — the instance metadata service.
 */
export function isPrivateAddress(address) {
  const host = String(address).toLowerCase().replace(/^\[|\]$/g, '');

  if (host.includes(':')) {
    const mapped = host.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isPrivateAddress(mapped[1]);
    if (host === '::1' || host === '::') return true;
    if (/^f[cd]/.test(host)) return true; // fc00::/7, unique local
    if (/^fe[89ab]/.test(host)) return true; // fe80::/10, link local
    return false;
  }

  const [a, b] = v4(host);
  if (!Number.isInteger(a) || !Number.isInteger(b)) return false;

  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 169 && b === 254) return true; // link local, and the metadata service
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 192 && b === 0) return true; // 192.0.0.0/24, protocol assignments
  if (a === 100 && b >= 64 && b <= 127) return true; // carrier-grade NAT
  if (a === 198 && (b === 18 || b === 19)) return true; // benchmarking
  if (a >= 224) return true; // multicast and reserved
  return false;
}

/** `169.254.169.254` and `[::1]` are addresses already — there is nothing to resolve. */
function ipLiteral(hostname) {
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(hostname)) return hostname;
  if (hostname.startsWith('[') || hostname.includes(':')) return hostname;
  return null;
}

/**
 * Throws unless this URL is one we are willing to fetch. Resolves the hostname, because the guard
 * has to be about where the request lands, not about how the name is spelled.
 */
export async function assertFetchable(url, { allowPrivateUrls = false, lookup = dnsLookup } = {}) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch (cause) {
    throw new PageFetchError('INVALID_URL', `"${url}" is not a URL.`, { url, cause });
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new PageFetchError('BAD_PROTOCOL', `${parsed.protocol} is not fetchable.`, { url });
  }

  if (allowPrivateUrls) return parsed;

  // An address written out is checked as written. Asking a resolver about it would work, but it
  // would make the guard depend on the resolver handing literals back unchanged.
  const literal = ipLiteral(parsed.hostname);
  if (literal) {
    if (isPrivateAddress(literal)) {
      throw new PageFetchError(
        'BLOCKED_PRIVATE',
        `${parsed.hostname} is a private address. Set ALLOW_PRIVATE_URLS=true to allow this in development.`,
        { url },
      );
    }
    return parsed;
  }

  let addresses;
  try {
    addresses = await lookup(parsed.hostname, { all: true });
  } catch (cause) {
    throw new PageFetchError('DNS_FAILED', `${parsed.hostname} did not resolve.`, { url, cause });
  }

  // Every address it resolves to, not just the first — a name with one public and one private
  // answer is the shape a rebinding attack takes.
  for (const { address } of addresses) {
    if (isPrivateAddress(address)) {
      throw new PageFetchError(
        'BLOCKED_PRIVATE',
        `${parsed.hostname} resolves to the private address ${address}. Set ALLOW_PRIVATE_URLS=true to allow this in development.`,
        { url },
      );
    }
  }

  return parsed;
}

function contentTypeOf(response) {
  return (response.headers.get('content-type') ?? '').toLowerCase();
}

/** Reads the body, giving up the moment it passes the cap rather than after buffering it all. */
async function readCapped(response, maxBytes, url) {
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw new PageFetchError('TOO_LARGE', `${url} declares ${declared} bytes.`, { url });
  }

  const reader = response.body?.getReader();
  if (!reader) return '';

  const chunks = [];
  let received = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    received += value.byteLength;
    if (received > maxBytes) {
      await reader.cancel();
      throw new PageFetchError('TOO_LARGE', `${url} is over ${maxBytes} bytes.`, { url });
    }
    chunks.push(value);
  }

  const charset = contentTypeOf(response).match(/charset=([^;]+)/)?.[1]?.trim();
  const buffer = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) {
    buffer.set(chunk, offset);
    offset += chunk.byteLength;
  }

  try {
    return new TextDecoder(charset || 'utf-8').decode(buffer);
  } catch {
    return new TextDecoder('utf-8').decode(buffer);
  }
}

/**
 * @returns {Promise<{url: string, status: number, contentType: string, body: string}>}
 *   `url` is where we ended up, which is what relative links must resolve against.
 */
export async function fetchPage(
  url,
  {
    allowPrivateUrls = false,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    maxBytes = DEFAULT_MAX_BYTES,
    userAgent = 'PrepKitBot/1.0 (interview preparation; respects robots.txt)',
    fetchImpl = fetch,
    lookup = dnsLookup,
  } = {},
) {
  let current = url;

  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    await assertFetchable(current, { allowPrivateUrls, lookup });

    let response;
    try {
      response = await fetchImpl(current, {
        redirect: 'manual',
        signal: AbortSignal.timeout(timeoutMs),
        headers: { 'user-agent': userAgent, accept: 'text/html,text/plain;q=0.9' },
      });
    } catch (cause) {
      const timedOut = cause?.name === 'TimeoutError' || cause?.name === 'AbortError';
      throw new PageFetchError(
        timedOut ? 'TIMEOUT' : 'NETWORK',
        timedOut ? `${current} did not answer within ${timeoutMs}ms.` : `${current} could not be reached.`,
        { url: current, cause },
      );
    }

    if (response.status >= 300 && response.status < 400 && response.headers.get('location')) {
      current = new URL(response.headers.get('location'), current).toString();
      continue;
    }

    if (!response.ok) {
      throw new PageFetchError('HTTP_ERROR', `${current} returned ${response.status}.`, {
        url: current,
        status: response.status,
      });
    }

    const contentType = contentTypeOf(response);
    if (!ALLOWED_TYPES.some((type) => contentType.startsWith(type))) {
      throw new PageFetchError(
        'UNSUPPORTED_TYPE',
        `${current} is ${contentType || 'of unknown type'}, not a page.`,
        { url: current, status: response.status },
      );
    }

    return {
      url: response.url || current,
      status: response.status,
      contentType,
      body: await readCapped(response, maxBytes, current),
    };
  }

  throw new PageFetchError('TOO_MANY_REDIRECTS', `${url} redirected more than ${MAX_REDIRECTS} times.`, {
    url,
  });
}

export default fetchPage;
