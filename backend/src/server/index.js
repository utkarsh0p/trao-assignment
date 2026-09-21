#!/usr/bin/env node
/**
 * The server entry point — the one place that reads the environment, opens the database, and
 * builds the model client.
 *
 * STACK.md's layering rule: the database URI and the auth secrets are validated here, and the LLM
 * key is validated in `scripts/evaluate.js`. Neither entry point demands the other's
 * configuration, which is what keeps `npm run evaluate` runnable from a clean clone with only a
 * Groq key in `.env`.
 */
import process from 'node:process';
import dotenv from 'dotenv';

import { createGroqClient } from '../llm/index.js';
import { createResearch } from '../pipeline/crawl.js';
import { createApp } from './app.js';
import { createJobRunner } from './jobs/runner.js';
import { connectDatabase, createMongoStore } from './store/mongo.js';
import { readServerEnv } from './env.js';

dotenv.config({ quiet: true });

async function main() {
  const env = readServerEnv();

  // Generation is what the server is for, so a missing key is a startup failure rather than a
  // surprise the first user discovers ninety seconds into their first kit.
  const client = createGroqClient();
  const research = createResearch({
    allowPrivateUrls: process.env.ALLOW_PRIVATE_URLS === 'true',
  });

  await connectDatabase(env.mongodbUri);
  console.log('mongo: connected');

  const store = createMongoStore();
  const runner = createJobRunner({ store, client, research });
  const app = createApp({ store, runner, env });

  const server = app.listen(env.port, () => {
    console.log(`prepkit api: http://localhost:${env.port} (${client.name} ${client.model})`);
    console.log(`cors: ${env.frontendUrl}`);
  });

  // Render sends SIGTERM on redeploy. Finishing in-flight requests is the difference between a
  // deploy and an outage — though a kit being generated at that moment is lost, which is exactly
  // what the stale-job check in GET /kits/:id exists to report.
  for (const signal of ['SIGTERM', 'SIGINT']) {
    process.on(signal, () => {
      console.log(`${signal}: shutting down`);
      server.close(() => process.exit(0));
      setTimeout(() => process.exit(1), 10_000).unref();
    });
  }
}

main().catch((error) => {
  console.error(`server failed to start: ${error.message}`);
  process.exitCode = 1;
});
