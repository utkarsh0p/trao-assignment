/**
 * Register, log in, refresh, log out.
 *
 * The refresh route is the interesting one. Rotation means the token presented is destroyed and a
 * new one issued, so a token that arrives twice is evidence that someone has a copy: the family is
 * revoked and both parties have to log in again. That is the whole benefit of storing refresh
 * tokens rather than trusting a stateless JWT until it expires.
 */
import { Router } from 'express';
import bcrypt from 'bcryptjs';

import { DuplicateEmailError } from '../store/index.js';
import { conflict, unauthorized } from '../http/errors.js';
import { validateBody } from '../http/validate.js';
import { LoginBody, RegisterBody } from '../http/schemas.js';
import {
  ACCESS_TTL_SECONDS,
  REFRESH_COOKIE,
  clearSessionCookies,
  hashToken,
  newFamilyId,
  setSessionCookies,
  signAccessToken,
  signRefreshToken,
  verifyRefreshToken,
} from '../auth/tokens.js';

export const BCRYPT_ROUNDS = 10;

/**
 * Compared against when no account matches, so a wrong email and a wrong password take the same
 * time to reject. Without it, response time answers "does this address have an account?".
 */
const DUMMY_HASH = bcrypt.hashSync('prepkit-timing-equaliser', BCRYPT_ROUNDS);

const publicUser = (user) => ({ id: user.id, email: user.email, name: user.name ?? '' });

export function createAuthRouter({ store, env, requireAuth }) {
  const router = Router();

  /** Issues a fresh pair and records the refresh half, hashed, against its family. */
  async function startSession(res, user, familyId = newFamilyId()) {
    const accessToken = signAccessToken({ user, secret: env.accessSecret });
    const refresh = signRefreshToken({ userId: user.id, familyId, secret: env.refreshSecret });

    await store.refreshTokens.create({
      jti: refresh.jti,
      userId: String(user.id),
      familyId: refresh.familyId,
      tokenHash: hashToken(refresh.token),
      expiresAt: refresh.expiresAt,
    });

    // The tokens go in httpOnly cookies and nowhere else. Returning the access token in the body
    // as well would invite the frontend to keep a copy somewhere a script can read, which is the
    // exact exposure httpOnly exists to prevent.
    setSessionCookies(res, {
      accessToken,
      refreshToken: refresh.token,
      isProduction: env.isProduction,
    });
  }

  router.post('/register', validateBody(RegisterBody), async (req, res) => {
    const { email, password, name } = req.body;

    let user;
    try {
      user = await store.users.create({
        email,
        name,
        passwordHash: await bcrypt.hash(password, BCRYPT_ROUNDS),
      });
    } catch (error) {
      if (error instanceof DuplicateEmailError) {
        // Registration is the one place an account's existence is unavoidably public: there is no
        // way to offer "sign up" without telling the visitor the address is taken.
        throw conflict('An account with that email already exists.');
      }
      throw error;
    }

    await startSession(res, user);
    res.status(201).json({ user: publicUser(user), expires_in: ACCESS_TTL_SECONDS });
  });

  router.post('/login', validateBody(LoginBody), async (req, res) => {
    const { email, password } = req.body;
    const user = await store.users.findByEmail(email);
    const matches = await bcrypt.compare(password, user?.passwordHash ?? DUMMY_HASH);

    if (!user || !matches) throw unauthorized('Email or password is wrong.');

    await startSession(res, user);
    res.json({ user: publicUser(user), expires_in: ACCESS_TTL_SECONDS });
  });

  router.post('/refresh', async (req, res) => {
    const presented = req.cookies?.[REFRESH_COOKIE] ?? req.body?.refresh_token;
    const payload = verifyRefreshToken(presented, env.refreshSecret);
    if (!payload?.jti) {
      clearSessionCookies(res, env);
      throw unauthorized('Refresh token missing or expired.');
    }

    const stored = await store.refreshTokens.findByJti(payload.jti);

    // Valid signature, no stored row: this token has already been rotated away, which means two
    // parties hold it. Everything descended from that login goes.
    if (!stored || stored.tokenHash !== hashToken(presented)) {
      if (payload.familyId) await store.refreshTokens.deleteFamily(payload.familyId);
      clearSessionCookies(res, env);
      throw unauthorized('That session has been revoked. Please sign in again.');
    }

    const user = await store.users.findById(stored.userId);
    if (!user) {
      await store.refreshTokens.deleteFamily(stored.familyId);
      clearSessionCookies(res, env);
      throw unauthorized('That account no longer exists.');
    }

    await store.refreshTokens.deleteByJti(stored.jti);
    await startSession(res, user, stored.familyId);
    res.json({ user: publicUser(user), expires_in: ACCESS_TTL_SECONDS });
  });

  /** Revokes this session for real — the stored row is deleted, not merely forgotten by the client. */
  router.post('/logout', async (req, res) => {
    const presented = req.cookies?.[REFRESH_COOKIE];
    const payload = verifyRefreshToken(presented, env.refreshSecret);
    if (payload?.jti) await store.refreshTokens.deleteByJti(payload.jti);

    clearSessionCookies(res, env);
    res.status(204).end();
  });

  /** Everywhere, not just here: what "log me out of every device" needs. */
  router.post('/logout-all', requireAuth, async (req, res) => {
    await store.refreshTokens.deleteForUser(req.user.id);
    clearSessionCookies(res, env);
    res.status(204).end();
  });

  router.get('/me', requireAuth, async (req, res) => {
    const user = await store.users.findById(req.user.id);
    if (!user) throw unauthorized('That account no longer exists.');
    res.json({ user: publicUser(user) });
  });

  return router;
}

export default createAuthRouter;
