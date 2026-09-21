/**
 * A running PrepKit API, without a database and without a model key.
 *
 * The app, the routes, the middleware, the auth and the job runner are the real ones — only the
 * store and the model are stand-ins. That is the point: a test that mocked the routes would prove
 * nothing about the server, and `mongodb-memory-server` would mean a binary download on install,
 * which STACK.md rules out.
 */
import request from 'supertest';

import { createApp } from '../src/server/app.js';
import { createJobRunner } from '../src/server/jobs/runner.js';
import { createMemoryStore } from '../src/server/store/memory.js';
import { createFakeClient } from '../src/llm/fake.js';

export const TEST_ENV = {
  accessSecret: `access-${'a'.repeat(40)}`,
  refreshSecret: `refresh-${'b'.repeat(40)}`,
  frontendUrl: 'http://localhost:3000',
  isProduction: false,
  port: 0,
  mongodbUri: 'not-used',
};

/** Retrieval that found two pages, with no crawler and no network. */
export const twoPages = async () => ({
  status: 'ok',
  links_considered: 9,
  company: 'Acme',
  pages: [
    { url: 'https://acme.example/', title: 'Acme', text: 'Acme sells billing infrastructure.' },
    { url: 'https://acme.example/careers', title: 'Careers', text: 'A take-home, then design.' },
  ],
  notes: [],
});

/** A company that could not be reached: a gap carried into the kit, never a failed job. */
export const noPages = async () => ({
  status: 'skipped',
  links_considered: 0,
  pages: [],
  notes: ['acme.example could not be reached, so this kit comes from the posting alone.'],
});

const silentLogger = { error() {}, warn() {}, log() {} };

/**
 * Builds the server and wraps the runner so a test can await the background job the route
 * deliberately does not await.
 */
export function buildServer({ client = createFakeClient(), research = twoPages } = {}) {
  const store = createMemoryStore();

  // A clock the test can push forward. Staleness is the one behaviour that depends on time
  // passing, and waiting five real minutes for it is not a test.
  let offset = 0;
  const millis = () => Date.now() + offset;

  const real = createJobRunner({
    store,
    client,
    research,
    logger: silentLogger,
    heartbeatMs: 25,
    now: () => new Date(millis()),
  });

  const inFlight = [];
  const track = (promise) => {
    inFlight.push(promise);
    return promise;
  };

  const runner = {
    ...real,
    generate: (record) => track(real.generate(record)),
    regenerate: (record, options) => track(real.regenerate(record, options)),
  };

  const app = createApp({
    store,
    runner,
    env: TEST_ENV,
    logger: silentLogger,
    rateLimits: false,
    now: millis,
  });

  return {
    app,
    store,
    client,
    /** Moves the server's clock forward without moving the records' timestamps. */
    advance(ms) {
      offset += ms;
    },
    /** Resolves once every job started so far has finished, however many it kicked off. */
    async settle() {
      // setImmediate defers the start, so yield first — otherwise there is nothing to await yet.
      await new Promise((resolve) => setImmediate(resolve));
      while (inFlight.length > 0) {
        await Promise.allSettled(inFlight.splice(0));
        await new Promise((resolve) => setImmediate(resolve));
      }
    },
  };
}

/** A registered, signed-in client. The agent carries the session cookies from here on. */
export async function signIn(app, email = 'ada@example.com', password = 'correct-horse-battery') {
  const agent = request.agent(app);
  const response = await agent.post('/auth/register').send({ email, password, name: 'Ada' });
  if (response.status !== 201) {
    throw new Error(`register failed: ${response.status} ${JSON.stringify(response.body)}`);
  }
  return agent;
}

export const JD = `Senior Backend Engineer at Acme

We need an engineer with 5+ years building services in Node, experience designing systems for
scale, and a track record of mentoring junior engineers. Billing domain experience is a plus.`;

/** Creates a kit and waits for the background job to finish. Returns the ready record. */
export async function createReadyKit(agent, server, overrides = {}) {
  const created = await agent
    .post('/kits')
    .send({ jd: JD, company_url: 'https://acme.example/', days: 3, ...overrides });

  await server.settle();
  const ready = await agent.get(`/kits/${created.body.id}`);
  return { id: created.body.id, created, ready };
}
