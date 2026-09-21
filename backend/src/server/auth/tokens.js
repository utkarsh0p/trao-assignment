/**
 * Sessions: a 15-minute access token and a rotating 7-day refresh token, both in httpOnly cookies.
 *
 * STACK.md's reasoning: stateless JWTs alone cannot answer "log me out everywhere" or "this token
 * was stolen", so the refresh token is stored — hashed, against its `jti` — and rotation is what
 * makes theft detectable. Every token descended from one login shares a `familyId`; presenting a
 * token that has already been rotated means two parties hold it, and the whole family goes.
 */
import { createHash, randomUUID } from 'node:crypto';
import jwt from 'jsonwebtoken';

export const ACCESS_TTL_SECONDS = 15 * 60;
export const REFRESH_TTL_SECONDS = 7 * 24 * 60 * 60;

export const ACCESS_COOKIE = 'pk_access';
export const REFRESH_COOKIE = 'pk_refresh';

/** Stored, never the token itself — a dumped database must not yield a usable session. */
export const hashToken = (token) => createHash('sha256').update(token).digest('hex');

export function signAccessToken({ user, secret, ttlSeconds = ACCESS_TTL_SECONDS }) {
  return jwt.sign({ email: user.email }, secret, {
    subject: String(user.id),
    expiresIn: ttlSeconds,
    issuer: 'prepkit',
    audience: 'prepkit-access',
  });
}

/** A new `jti` every rotation; `familyId` survives them all. */
export function signRefreshToken({ userId, familyId, jti = randomUUID(), secret }) {
  const token = jwt.sign({ familyId }, secret, {
    subject: String(userId),
    jwtid: jti,
    expiresIn: REFRESH_TTL_SECONDS,
    issuer: 'prepkit',
    audience: 'prepkit-refresh',
  });
  return { token, jti, familyId, expiresAt: new Date(Date.now() + REFRESH_TTL_SECONDS * 1000) };
}

/** @returns the payload, or null. An expired or forged token is not an exception worth throwing. */
export function verifyToken(token, secret, audience) {
  if (!token) return null;
  try {
    return jwt.verify(token, secret, { issuer: 'prepkit', audience });
  } catch {
    return null;
  }
}

export const verifyAccessToken = (token, secret) => verifyToken(token, secret, 'prepkit-access');
export const verifyRefreshToken = (token, secret) => verifyToken(token, secret, 'prepkit-refresh');

/**
 * Cross-origin in production — Vercel to Render — which needs `sameSite: 'none'` and `secure`.
 * Both are wrong on localhost over http, where the cookie would simply be dropped, so the setting
 * follows NODE_ENV. STACK.md: this works locally and fails silently in production if it is not.
 */
export function cookieOptions({ isProduction, maxAgeSeconds }) {
  return {
    httpOnly: true,
    sameSite: isProduction ? 'none' : 'lax',
    secure: isProduction,
    path: '/',
    maxAge: maxAgeSeconds * 1000,
  };
}

export function setSessionCookies(res, { accessToken, refreshToken, isProduction }) {
  res.cookie(ACCESS_COOKIE, accessToken, cookieOptions({ isProduction, maxAgeSeconds: ACCESS_TTL_SECONDS }));
  res.cookie(REFRESH_COOKIE, refreshToken, cookieOptions({ isProduction, maxAgeSeconds: REFRESH_TTL_SECONDS }));
}

export function clearSessionCookies(res, { isProduction }) {
  const options = { ...cookieOptions({ isProduction, maxAgeSeconds: 0 }) };
  delete options.maxAge;
  res.clearCookie(ACCESS_COOKIE, options);
  res.clearCookie(REFRESH_COOKIE, options);
}

export const newFamilyId = () => randomUUID();
