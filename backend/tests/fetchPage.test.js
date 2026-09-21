import { describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_MAX_BYTES,
  PageFetchError,
  assertFetchable,
  fetchPage,
  isPrivateAddress,
} from '../src/pipeline/fetchPage.js';

/** A resolver that answers with whatever the test says the name points at. */
const resolvesTo = (...addresses) => async () => addresses.map((address) => ({ address }));

const publicLookup = resolvesTo('93.184.216.34');

function htmlResponse(body, { status = 200, contentType = 'text/html; charset=utf-8', headers = {} } = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    url: 'https://example.test/',
    headers: new Headers({ 'content-type': contentType, ...headers }),
    body: new Blob([body]).stream(),
  };
}

const fetchReturning = (response) => vi.fn(async () => response);

describe('isPrivateAddress', () => {
  it('knows the ranges that must never be fetched', () => {
    for (const address of [
      '127.0.0.1', '10.1.2.3', '192.168.0.5', '172.16.0.1', '172.31.255.255',
      '169.254.169.254', '0.0.0.0', '100.64.0.1', '::1', 'fc00::1', 'fd12::3',
      'fe80::1', '::ffff:127.0.0.1', '224.0.0.1',
    ]) {
      expect(isPrivateAddress(address), address).toBe(true);
    }
  });

  it('lets public addresses through', () => {
    for (const address of ['93.184.216.34', '8.8.8.8', '172.32.0.1', '2606:4700::1111', '198.20.0.1']) {
      expect(isPrivateAddress(address), address).toBe(false);
    }
  });
});

describe('assertFetchable', () => {
  it('rejects a hostname that resolves to a private address', async () => {
    const promise = assertFetchable('https://db.internal.example/', {
      lookup: resolvesTo('10.0.0.5'),
    });
    await expect(promise).rejects.toThrow(PageFetchError);
    await expect(promise).rejects.toThrow(/ALLOW_PRIVATE_URLS/);
  });

  it('rejects a name that resolves to one public and one private address', async () => {
    // A rebinding answer is still an answer we must not follow.
    await expect(
      assertFetchable('https://rebind.example/', { lookup: resolvesTo('93.184.216.34', '127.0.0.1') }),
    ).rejects.toThrow(/private address/);
  });

  it('allows private addresses only when told to, and then without a lookup', async () => {
    const lookup = vi.fn();
    await expect(
      assertFetchable('http://localhost:8099/acme/', { allowPrivateUrls: true, lookup }),
    ).resolves.toBeInstanceOf(URL);
    expect(lookup).not.toHaveBeenCalled();
  });

  it('rejects anything that is not http', async () => {
    for (const url of ['file:///etc/passwd', 'ftp://example.test/x', 'gopher://example.test']) {
      await expect(assertFetchable(url, { lookup: publicLookup })).rejects.toThrow(/not fetchable/);
    }
  });

  it('rejects a string that is not a URL', async () => {
    await expect(assertFetchable('careers page', { lookup: publicLookup })).rejects.toThrow(/not a URL/);
  });
});

describe('fetchPage', () => {
  const options = { lookup: publicLookup };

  it('returns the body of a page it is allowed to read', async () => {
    const fetchImpl = fetchReturning(htmlResponse('<h1>Hello</h1>'));
    const page = await fetchPage('https://example.test/', { ...options, fetchImpl });

    expect(page.status).toBe(200);
    expect(page.body).toBe('<h1>Hello</h1>');
    expect(page.contentType).toContain('text/html');
  });

  it('identifies itself and asks only for pages', async () => {
    const fetchImpl = fetchReturning(htmlResponse('<p>ok</p>'));
    await fetchPage('https://example.test/', { ...options, fetchImpl });

    const [, init] = fetchImpl.mock.calls[0];
    expect(init.headers['user-agent']).toMatch(/PrepKitBot/);
    expect(init.redirect).toBe('manual');
  });

  it('refuses a PDF or anything else that is not a page', async () => {
    const fetchImpl = fetchReturning(htmlResponse('%PDF-1.4', { contentType: 'application/pdf' }));
    await expect(fetchPage('https://example.test/x.pdf', { ...options, fetchImpl })).rejects.toThrow(
      /not a page/,
    );
  });

  it('refuses a body that declares itself too large', async () => {
    const fetchImpl = fetchReturning(
      htmlResponse('<p>small</p>', { headers: { 'content-length': String(DEFAULT_MAX_BYTES + 1) } }),
    );
    await expect(fetchPage('https://example.test/', { ...options, fetchImpl })).rejects.toThrow(/bytes/);
  });

  it('stops reading a body that runs past the cap without declaring it', async () => {
    const fetchImpl = fetchReturning(htmlResponse('x'.repeat(5000)));
    await expect(
      fetchPage('https://example.test/', { ...options, fetchImpl, maxBytes: 1000 }),
    ).rejects.toThrow(/over 1000 bytes/);
  });

  it('reports a 404 as an HTTP error, with the status', async () => {
    const fetchImpl = fetchReturning(htmlResponse('Not found', { status: 404 }));
    try {
      await fetchPage('https://example.test/gone', { ...options, fetchImpl });
      expect.unreachable();
    } catch (error) {
      expect(error.code).toBe('HTTP_ERROR');
      expect(error.status).toBe(404);
    }
  });

  it('reports a timeout as a timeout', async () => {
    const fetchImpl = vi.fn(async () => {
      throw Object.assign(new Error('aborted'), { name: 'TimeoutError' });
    });
    try {
      await fetchPage('https://example.test/', { ...options, fetchImpl, timeoutMs: 5 });
      expect.unreachable();
    } catch (error) {
      expect(error.code).toBe('TIMEOUT');
    }
  });

  it('checks a redirect target as carefully as the first URL', async () => {
    const fetchImpl = vi.fn(async () =>
      htmlResponse('', { status: 302, headers: { location: 'http://169.254.169.254/latest/meta-data/' } }),
    );

    // A site that redirects us at the cloud metadata service gets refused at the second hop.
    await expect(
      fetchPage('https://example.test/', { lookup: publicLookup, fetchImpl }),
    ).rejects.toThrow(/private address/);
  });

  it('follows an ordinary redirect', async () => {
    const responses = [
      htmlResponse('', { status: 301, headers: { location: '/careers/' } }),
      htmlResponse('<h1>Careers</h1>'),
    ];
    const fetchImpl = vi.fn(async () => responses.shift());
    const page = await fetchPage('https://example.test/jobs', { ...options, fetchImpl });

    expect(page.body).toBe('<h1>Careers</h1>');
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('gives up on a redirect loop', async () => {
    const fetchImpl = vi.fn(async () =>
      htmlResponse('', { status: 302, headers: { location: 'https://example.test/loop' } }),
    );
    await expect(fetchPage('https://example.test/loop', { ...options, fetchImpl })).rejects.toThrow(
      /redirected more than/,
    );
  });
});
