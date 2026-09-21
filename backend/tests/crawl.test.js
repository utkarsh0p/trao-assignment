import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startFixtures } from '../scripts/serve-fixtures.js';
import { createFakeClient, purposesOf } from '../src/llm/fake.js';
import { extractLinks, rankLinks, researchCompany, scoreLink } from '../src/pipeline/crawl.js';
import { scrapePage } from '../src/pipeline/scrape.js';

let fixtures;

beforeAll(async () => {
  // A real HTTP server on a real port: relative links, robots.txt and 404s all behave as they do
  // on a live site, which is the only way to know the crawler handles them.
  fixtures = await startFixtures({ port: 0 });
});

afterAll(() => fixtures.close());

/** The crawler, pointed at one of the fixture sites. Loopback needs the development flag. */
const research = (site, overrides = {}) =>
  researchCompany({
    companyUrl: `${fixtures.baseUrl}/${site}/`,
    client: createFakeClient(),
    allowPrivateUrls: true,
    ...overrides,
  });

const urlsOf = (result) => result.pages.map((page) => page.url);
const textOf = (result) => result.pages.map((page) => page.text).join('\n');

describe('researchCompany — a site with an ordinary careers page', () => {
  it('reads the home page and finds how the company hires', async () => {
    const result = await research('acme');

    expect(result.status).toBe('ok');
    expect(result.company).toBe('Acme Billing');
    expect(urlsOf(result)).toContain(`${fixtures.baseUrl}/acme/`);
    expect(urlsOf(result)).toContain(`${fixtures.baseUrl}/acme/careers/how-we-hire.html`);
    expect(textOf(result)).toContain('System design');
    expect(result.links_considered).toBeGreaterThan(0);
  });

  it('asks the model which links to read rather than guessing paths', async () => {
    const client = createFakeClient();
    await research('acme', { client });

    expect(purposesOf(client).filter((p) => p === 'shortlist-links').length).toBeGreaterThan(0);
  });

  it('stays inside the page budget', async () => {
    const result = await research('acme', { maxPages: 3 });
    expect(result.pages).toHaveLength(3);
  });
});

describe('researchCompany — hiring information at a path nothing could guess', () => {
  it('follows the handbook to the page that describes the interview', async () => {
    // Northwind has no /careers. The only way to this page is the handbook link, and then a link
    // inside the handbook — which is why the crawl runs two rounds.
    const result = await research('northwind');

    expect(urlsOf(result)).toContain(`${fixtures.baseUrl}/northwind/handbook/joining-northwind.html`);
    expect(textOf(result)).toContain('pairing session');
    expect(urlsOf(result).some((url) => url.includes('/careers'))).toBe(false);
  });
});

describe('researchCompany — a site with no hiring page it will let us read', () => {
  it('honours robots.txt and records the page it did not read', async () => {
    const result = await research('borealis');

    expect(result.status).toBe('ok');
    expect(urlsOf(result)).not.toContain(`${fixtures.baseUrl}/borealis/internal/interview-loop.html`);
    expect(result.notes.some((note) => note.includes('robots.txt disallows it'))).toBe(true);
    expect(textOf(result)).not.toContain('Internal: interview loop');
  });

  it('still returns what it could read, so the kit has something to say', async () => {
    const result = await research('borealis');

    expect(result.pages.length).toBeGreaterThan(0);
    expect(textOf(result)).toContain('spectrometers');
  });
});

describe('researchCompany — a company that cannot be reached', () => {
  it('reports the 404 once, in words, and does not throw', async () => {
    const result = await research('gone');

    expect(result.status).toBe('failed');
    expect(result.pages).toEqual([]);
    expect(result.notes).toHaveLength(1);
    expect(result.notes[0]).toContain('returned 404');
    expect(result.notes[0]).toContain('job description alone');
  });

  it('reports a host that does not exist without throwing', async () => {
    const result = await researchCompany({
      companyUrl: 'http://nothing-here.invalid/',
      client: createFakeClient(),
    });

    expect(result.status).toBe('failed');
    expect(result.notes[0]).toMatch(/did not resolve|could not be reached/);
  });

  it('refuses a private address unless development says otherwise', async () => {
    const result = await researchCompany({
      companyUrl: `${fixtures.baseUrl}/acme/`,
      client: createFakeClient(),
      allowPrivateUrls: false,
    });

    expect(result.status).toBe('failed');
    expect(result.notes[0]).toContain('private address');
  });
});

describe('link extraction and ranking', () => {
  const base = 'https://acme.test/about/team.html';

  it('resolves relative links against the page they came from', () => {
    const html = `<a href="../careers/">Careers</a><a href="/handbook">Handbook</a>
      <a href="deeper.html">Deeper</a><a href="https://acme.test/x">Absolute</a>`;
    const urls = extractLinks(html, base).map((link) => link.url);

    expect(urls).toContain('https://acme.test/careers/');
    expect(urls).toContain('https://acme.test/handbook');
    expect(urls).toContain('https://acme.test/about/deeper.html');
  });

  it('leaves other people’s websites alone', () => {
    const html = `<a href="https://twitter.com/acme">Twitter</a><a href="/jobs">Jobs</a>`;
    expect(extractLinks(html, base).map((link) => link.url)).toEqual(['https://acme.test/jobs']);
  });

  it('skips mailto, tel, fragments and files that are not pages', () => {
    const html = `<a href="mailto:a@b.c">Mail</a><a href="tel:123">Call</a><a href="#top">Top</a>
      <a href="/brochure.pdf">PDF</a><a href="/logo.svg">Logo</a><a href="/careers">Careers</a>`;
    expect(extractLinks(html, base).map((link) => link.url)).toEqual(['https://acme.test/careers']);
  });

  it('treats a page as one link however many times it appears', () => {
    const html = `<a href="/careers">Careers</a><a href="/careers#open">Open roles</a>
      <a href="/careers?utm=nav">Careers</a>`;
    expect(extractLinks(html, base)).toHaveLength(1);
  });

  it('ranks hiring pages above company pages above product pages', () => {
    const score = (url, text = '') => scoreLink({ url: `https://acme.test${url}`, text });

    expect(score('/careers/')).toBeGreaterThan(score('/about'));
    expect(score('/about')).toBeGreaterThan(score('/product'));
    expect(score('/handbook/joining-northwind.html')).toBeGreaterThan(score('/handbook/on-call.html'));
  });

  it('pushes legal and account pages out of the running entirely', () => {
    const links = [
      { url: 'https://acme.test/privacy', text: 'Privacy' },
      { url: 'https://acme.test/login', text: 'Log in' },
      { url: 'https://acme.test/careers/', text: 'Careers' },
    ];
    expect(rankLinks(links).map((link) => link.url)).toEqual(['https://acme.test/careers/']);
  });

  it('reads the link text, not only the address', () => {
    const cryptic = { url: 'https://acme.test/p/42', text: 'How we hire' };
    const plain = { url: 'https://acme.test/p/43', text: 'Our offices' };
    expect(scoreLink(cryptic)).toBeGreaterThan(scoreLink(plain));
  });
});

describe('scrapePage', () => {
  it('keeps the content and drops the furniture', () => {
    const page = scrapePage({
      url: 'https://acme.test/',
      body: `<html><head><title>Acme — billing</title></head><body>
        <nav><a href="/x">Nav link</a></nav>
        <main><h1>Heading</h1><p>The actual sentence.</p></main>
        <footer>Copyright notice</footer>
        <script>console.log('tracking')</script></body></html>`,
    });

    expect(page.title).toBe('Acme — billing');
    expect(page.text).toContain('The actual sentence.');
    expect(page.text).not.toContain('Nav link');
    expect(page.text).not.toContain('Copyright notice');
    expect(page.text).not.toContain('tracking');
  });

  it('caps a very long page and says that it did', () => {
    const body = `<main>${'<p>A sentence that goes on. </p>'.repeat(2000)}</main>`;
    const page = scrapePage({ url: 'https://acme.test/', body }, { maxChars: 500 });

    expect(page.text.length).toBeLessThan(700);
    expect(page.text).toContain('[truncated]');
  });

  it('passes plain text through without parsing it as markup', () => {
    const page = scrapePage({
      url: 'https://acme.test/robots.txt',
      body: 'User-agent: *\nDisallow: /internal/',
      contentType: 'text/plain; charset=utf-8',
    });
    expect(page.text).toContain('Disallow: /internal/');
  });
});

describe('the whole pipeline against a real site', () => {
  /** generateKit with the real crawler underneath it — only the model is a stand-in. */
  const kitFor = async (site, days = 5) => {
    const { generateKit } = await import('../src/pipeline/generateKit.js');
    const { createResearch } = await import('../src/pipeline/crawl.js');
    const { KitSchema } = await import('../src/schema/kit.js');

    const kit = await generateKit({
      jd: 'Senior Backend Engineer. 5+ years Node, systems at scale, mentoring juniors. Billing domain a plus.',
      company_url: `${fixtures.baseUrl}/${site}/`,
      days,
      client: createFakeClient(),
      research: createResearch({ allowPrivateUrls: true }),
    });

    expect(KitSchema.safeParse(kit).success).toBe(true);
    return kit;
  };

  it('puts what the company says about hiring into the kit', async () => {
    const kit = await kitFor('acme');

    expect(kit.source.company).toBe('Acme Billing');
    expect(kit.source.pages_used.length).toBeGreaterThan(1);
    expect(kit.company_brief.sources).toEqual(kit.source.pages_used);
    expect(kit.questions.length).toBeGreaterThan(0);
  });

  it('says plainly when a company publishes nothing about how it hires', async () => {
    const kit = await kitFor('borealis');

    expect(kit.source.notes.some((note) => note.includes('robots.txt disallows it'))).toBe(true);
    expect(kit.questions.length).toBeGreaterThan(0);
    expect(kit.schedule.days).toHaveLength(5);
  });

  it('still produces a kit when the company site is not there at all', async () => {
    const kit = await kitFor('gone', 3);

    expect(kit.source.pages_used).toEqual([]);
    expect(kit.company_brief.what_they_do).toBe('');
    expect(kit.source.notes.some((note) => note.includes('returned 404'))).toBe(true);
    // The posting alone is still enough for a kit, and that is the point.
    expect(kit.questions.length).toBeGreaterThan(0);
    expect(kit.schedule.days).toHaveLength(3);
    expect(kit.coverage.uncovered_requirement_ids).toEqual([]);
  });
});
