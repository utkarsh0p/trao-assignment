/**
 * The Express app, assembled from parts it is given rather than parts it imports.
 *
 * Nothing in here reaches for `process.env`, opens a database connection, or creates an LLM
 * client: `index.js` does all three and passes the results in. That is what lets the tests drive
 * the real routes, the real auth and the real job runner against an in-memory store and a
 * stand-in model, with no network and no mongod.
 */
import express from 'express';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';

import { createRequireAuth } from './auth/requireAuth.js';
import { createAuthRouter } from './routes/auth.js';
import { createKitsRouter } from './routes/kits.js';
import { errorHandler, notFoundHandler } from './http/errors.js';

/** Generous: one person polling a running kit every two seconds is ~450 requests in a quarter hour. */
export const API_LIMIT = { windowMs: 15 * 60_000, limit: 1000 };

/** Tight: this is the window an attacker would guess passwords in. */
export const AUTH_LIMIT = { windowMs: 15 * 60_000, limit: 30 };

/** A kit is a minute and a half of model time, and the free tier is shared by everyone. */
export const GENERATION_LIMIT = { windowMs: 60 * 60_000, limit: 30 };

const limiter = (options) =>
  rateLimit({
    ...options,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    message: { error: { code: 'RATE_LIMITED', message: 'Too many requests. Try again shortly.' } },
  });

const passThrough = (req, res, next) => next();

/**
 * @param {{store: object, runner: object, env: object, logger?: object,
 *          rateLimits?: boolean, now?: () => number}} deps
 */
export function createApp({ store, runner, env, logger = console, rateLimits = true, now = Date.now }) {
  const app = express();

  // Render terminates TLS in front of the process, so without this every request looks like it
  // came from the proxy and the rate limiters would count the whole internet as one client.
  app.set('trust proxy', 1);
  app.disable('x-powered-by');

  app.use(helmet());

  // The frontend is on another origin and the session lives in cookies, so credentials must be
  // allowed and the origin must be explicit — `*` and credentials are mutually exclusive.
  app.use(cors({ origin: env.frontendUrl, credentials: true }));

  // Only JSON is parsed, which also means a cross-site form post — the one request a browser will
  // send cross-origin without a preflight — arrives with an empty body and fails validation.
  app.use(express.json({ limit: '1mb' }));
  app.use(cookieParser());

  const api = rateLimits ? limiter(API_LIMIT) : passThrough;
  const auth = rateLimits ? limiter(AUTH_LIMIT) : passThrough;
  const generation = rateLimits ? limiter(GENERATION_LIMIT) : passThrough;

  // Unauthenticated and unlimited on purpose: Render sleeps a free service after 15 minutes, and
  // the frontend pings this on page load so the cold start happens before the user asks for
  // anything (STACK.md).
  app.get('/health', (req, res) => {
    res.json({ ok: true, service: 'prepkit', time: new Date().toISOString() });
  });

  app.use(api);

  const requireAuth = createRequireAuth({ accessSecret: env.accessSecret });
  app.use('/auth', auth, createAuthRouter({ store, env, requireAuth }));
  app.use(
    '/kits',
    requireAuth,
    createKitsRouter({ store, runner, generationLimiter: generation, now }),
  );

  app.use(notFoundHandler);
  app.use(errorHandler(logger));

  return app;
}

export default createApp;
