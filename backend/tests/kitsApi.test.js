import { describe, expect, it } from 'vitest';

import { KitSchema } from '../src/schema/kit.js';
import { createFakeClient } from '../src/llm/fake.js';
import { STALE_ERROR } from '../src/server/routes/kits.js';
import { JD, buildServer, createReadyKit, noPages, signIn } from './serverHelpers.js';

describe('POST /kits', () => {
  it('answers 202 with an id before the pipeline has run, then produces a kit', async () => {
    const server = buildServer();
    const agent = await signIn(server.app);

    const created = await agent
      .post('/kits')
      .send({ jd: JD, company_url: 'https://acme.example/', days: 3 });

    expect(created.status).toBe(202);
    expect(created.body.id).toBeTruthy();
    expect(created.body.status).toBe('queued');

    await server.settle();

    const ready = await agent.get(`/kits/${created.body.id}`);
    expect(ready.body.status).toBe('ready');
    expect(KitSchema.safeParse(ready.body.kit).success).toBe(true);
    expect(ready.body.kit.schedule.days).toHaveLength(3);
  });

  it('reports per-step progress while it works, and every step by the end', async () => {
    const server = buildServer();
    const agent = await signIn(server.app);
    const { ready } = await createReadyKit(agent, server);

    const steps = ready.body.progress.map((entry) => entry.step);
    expect(new Set(steps)).toEqual(new Set(['extract', 'crawl', 'scrape', 'generate', 'coverage', 'schedule']));
    for (const entry of ready.body.progress) expect(entry.at).toBeTruthy();

    // One entry per category, not four `generate` entries overwriting each other.
    const categories = ready.body.progress
      .filter((entry) => entry.detail?.category)
      .map((entry) => entry.detail.category);
    expect(new Set(categories)).toEqual(
      new Set(['technical', 'behavioural', 'system-design', 'company-fit']),
    );
  });

  it('returns the existing job when the same posting and company are submitted twice', async () => {
    const server = buildServer();
    const agent = await signIn(server.app);
    const body = { jd: JD, company_url: 'https://acme.example/', days: 3 };

    const first = await agent.post('/kits').send(body);
    // Whitespace and a trailing slash are not a different posting.
    const second = await agent
      .post('/kits')
      .send({ ...body, jd: `${JD}\n`, company_url: 'https://acme.example' });

    expect(second.status).toBe(200);
    expect(second.body.duplicate).toBe(true);
    expect(second.body.id).toBe(first.body.id);

    await server.settle();
    expect((await agent.get('/kits')).body.kits).toHaveLength(1);
  });

  it('runs a second job when the client insists with its own idempotency key', async () => {
    const server = buildServer();
    const agent = await signIn(server.app);
    const body = { jd: JD, company_url: 'https://acme.example/', days: 3 };

    const first = await agent.post('/kits').send(body);
    const second = await agent.post('/kits').set('Idempotency-Key', 'second-go').send(body);

    expect(second.status).toBe(202);
    expect(second.body.id).not.toBe(first.body.id);
    await server.settle();
  });

  it('records an unreachable company as a gap in the kit, not as a failed job', async () => {
    const server = buildServer({ research: noPages });
    const agent = await signIn(server.app);
    const { ready } = await createReadyKit(agent, server);

    expect(ready.body.status).toBe('ready');
    expect(ready.body.kit.source.pages_used).toEqual([]);
    expect(ready.body.kit.source.notes.join(' ')).toContain('could not be reached');
    expect(ready.body.kit.questions.length).toBeGreaterThan(0);
  });

  it('records a generation failure as a failed job with a code the client can read', async () => {
    const client = createFakeClient({
      fail: (call) => (call.purpose === 'extract-requirements' ? new Error('model exploded') : undefined),
    });
    const server = buildServer({ client });
    const agent = await signIn(server.app);
    const { ready } = await createReadyKit(agent, server);

    expect(ready.body.status).toBe('failed');
    expect(ready.body.kit).toBeNull();
    expect(ready.body.error.code).toBe('UNEXPECTED_ERROR');
  });

  it('rejects a body that is missing the company URL', async () => {
    const server = buildServer();
    const agent = await signIn(server.app);

    const response = await agent.post('/kits').send({ jd: JD, days: 3 });
    expect(response.status).toBe(400);
    expect(response.body.error.detail[0].field).toBe('company_url');
  });

  it('takes several description-and-company pairs at once', async () => {
    const server = buildServer();
    const agent = await signIn(server.app);

    const response = await agent.post('/kits/batch').send({
      items: [
        { jd: JD, company_url: 'https://acme.example/', days: 3 },
        { jd: `${JD} And Kubernetes.`, company_url: 'https://northwind.example/', days: 5 },
      ],
    });

    expect(response.status).toBe(202);
    expect(response.body.kits).toHaveLength(2);
    await server.settle();

    const list = await agent.get('/kits');
    expect(list.body.kits.map((kit) => kit.status)).toEqual(['ready', 'ready']);
    expect(list.body.kits.map((kit) => kit.days).sort()).toEqual([3, 5]);
  });

  it('does not re-run rows of a batch file that were already submitted', async () => {
    const server = buildServer();
    const agent = await signIn(server.app);
    const first = { jd: JD, company_url: 'https://acme.example/', days: 3 };

    await agent.post('/kits/batch').send({ items: [first] });
    const second = await agent
      .post('/kits/batch')
      .send({ items: [first, { jd: `${JD} Plus Go.`, company_url: 'https://b.example/', days: 2 }] });

    expect(second.body.kits.map((kit) => kit.duplicate)).toEqual([true, false]);
    await server.settle();
    expect((await agent.get('/kits')).body.kits).toHaveLength(2);
  });
});

describe('reading kits', () => {
  it('shows a user only their own kits, and 404s on someone else\'s', async () => {
    const server = buildServer();
    const ada = await signIn(server.app, 'ada@example.com');
    const grace = await signIn(server.app, 'grace@example.com');

    const { id } = await createReadyKit(ada, server);

    // 404 rather than 403: the existence of another account's kit does not leak.
    expect((await grace.get(`/kits/${id}`)).status).toBe(404);
    expect((await grace.get('/kits')).body.kits).toEqual([]);
    expect((await grace.delete(`/kits/${id}`)).status).toBe(404);
    expect((await grace.patch(`/kits/${id}/brief`).send({ summary: 'mine now' })).status).toBe(404);

    // And it is still there for its owner.
    expect((await ada.get(`/kits/${id}`)).status).toBe(200);
  });

  it('needs a session', async () => {
    const server = buildServer();
    const { default: request } = await import('supertest');

    expect((await request(server.app).get('/kits')).status).toBe(401);
  });

  it('reports a job whose heartbeat stopped as failed rather than running for ever', async () => {
    const server = buildServer();
    const agent = await signIn(server.app);

    const created = await agent
      .post('/kits')
      .send({ jd: JD, company_url: 'https://acme.example/', days: 3 });
    await server.settle();

    // The process died mid-kit: the record still says running, and nothing touches it again.
    await server.store.kits.update({
      id: created.body.id,
      patch: { status: 'running', kit: null },
    });
    server.advance(30 * 60_000);

    const response = await agent.get(`/kits/${created.body.id}`);
    expect(response.body.status).toBe('failed');
    expect(response.body.error).toEqual(STALE_ERROR);
  });

  it('deletes a kit', async () => {
    const server = buildServer();
    const agent = await signIn(server.app);
    const { id } = await createReadyKit(agent, server);

    expect((await agent.delete(`/kits/${id}`)).status).toBe(204);
    expect((await agent.get(`/kits/${id}`)).status).toBe(404);
  });

  it('has a health check that needs no session, for the cold start ping', async () => {
    const server = buildServer();
    const { default: request } = await import('supertest');

    const response = await request(server.app).get('/health');
    expect(response.status).toBe(200);
    expect(response.body.ok).toBe(true);
  });
});
