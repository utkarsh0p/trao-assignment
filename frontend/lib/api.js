/**
 * The single chokepoint for every request the browser makes.
 *
 * Two things here are load-bearing and easy to break:
 *
 *   - `credentials: 'include'` on every call. The session is an httpOnly cookie; JavaScript
 *     cannot read it, attach it to a header, or check when it expires. Omit this and every
 *     request is anonymous.
 *   - `Content-Type: application/json` on every call. It is not decoration — it forces a CORS
 *     preflight, and that preflight is the backend's CSRF defence (backend/src/server/app.js).
 */

export const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';

/** Paths where a 401 is the answer, not a stale access token. */
const NO_REFRESH = ['/auth/login', '/auth/register', '/auth/refresh', '/auth/logout'];

export class ApiError extends Error {
  constructor({ status, code, message, detail }) {
    super(message || 'Something went wrong.');
    this.name = 'ApiError';
    this.status = status;
    this.code = code || 'INTERNAL_ERROR';
    this.detail = detail || [];
  }

  /** The message for a named field, if the server complained about one. */
  fieldError(field) {
    return this.detail.find((d) => d.field === field)?.message;
  }
}

/* ── Session-lost subscribers ───────────────────────────────────────────────
   api.js cannot import the router or the query client without dragging React
   into a module that has to stay callable from anywhere. So it announces, and
   lib/session.js listens. */

const sessionLostHandlers = new Set();

export function onSessionLost(handler) {
  sessionLostHandlers.add(handler);
  return () => sessionLostHandlers.delete(handler);
}

function announceSessionLost() {
  for (const handler of sessionLostHandlers) handler();
}

/* ── Refresh, exactly once at a time ────────────────────────────────────────
   The refresh token rotates on use, and a rotated token presented a second
   time is read as theft: the backend revokes the whole family and every tab
   is signed out. With several polls in flight, two parallel refreshes is the
   likeliest way to cause that. So all callers wait on one promise. */

let refreshInFlight = null;

function refreshSession() {
  refreshInFlight ??= fetch(`${API_URL}/auth/refresh`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
  })
    .then((res) => res.ok)
    .catch(() => false)
    .finally(() => {
      refreshInFlight = null;
    });

  return refreshInFlight;
}

async function parse(res) {
  if (res.status === 204) return null;
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    // A proxy or a cold host answered with HTML. Do not show the user markup.
    throw new ApiError({
      status: res.status,
      code: 'INTERNAL_ERROR',
      message: 'The server sent a response we could not read.',
    });
  }
}

async function send(path, { method = 'GET', body, headers = {}, signal } = {}) {
  let res;
  try {
    res = await fetch(`${API_URL}${path}`, {
      method,
      credentials: 'include',
      signal,
      headers: { 'Content-Type': 'application/json', ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (cause) {
    if (cause?.name === 'AbortError') throw cause;
    throw new ApiError({
      status: 0,
      code: 'NETWORK_ERROR',
      message: `Could not reach the server at ${API_URL}. Check that it is running.`,
    });
  }

  const payload = await parse(res);

  if (!res.ok) {
    throw new ApiError({
      status: res.status,
      code: payload?.error?.code,
      message: payload?.error?.message,
      detail: payload?.error?.detail,
    });
  }

  return payload;
}

/**
 * Make a request. On a 401, refresh once and replay — that is the ordinary
 * shape of a 15-minute access token expiring under a signed-in user, not a
 * reason to throw them back to the login page.
 */
export async function api(path, options = {}) {
  try {
    return await send(path, options);
  } catch (error) {
    const refreshable =
      error instanceof ApiError &&
      error.status === 401 &&
      !NO_REFRESH.some((prefix) => path.startsWith(prefix));

    if (!refreshable) throw error;

    const refreshed = await refreshSession();
    if (!refreshed) {
      announceSessionLost();
      throw error;
    }

    try {
      return await send(path, options);
    } catch (retryError) {
      if (retryError instanceof ApiError && retryError.status === 401) announceSessionLost();
      throw retryError;
    }
  }
}

export const get = (path, options) => api(path, { ...options, method: 'GET' });
export const post = (path, body, options) => api(path, { ...options, method: 'POST', body });
export const patch = (path, body, options) => api(path, { ...options, method: 'PATCH', body });
export const del = (path, options) => api(path, { ...options, method: 'DELETE' });

/**
 * Wake the host. Render's free tier sleeps after fifteen minutes and the first
 * request then takes about thirty seconds — better spent behind the login form
 * than in front of a spinner. Failure here is not worth reporting.
 */
export function pingHealth() {
  return fetch(`${API_URL}/health`, { credentials: 'include' }).catch(() => {});
}
