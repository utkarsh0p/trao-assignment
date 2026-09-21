/**
 * Everything under /kits sits behind this. It puts `req.user = {id, email}` in place and nothing
 * else — the handlers below it scope their own queries by `req.user.id`, which is the rule that
 * keeps one account's kits invisible to another.
 */
import { unauthorized } from '../http/errors.js';
import { ACCESS_COOKIE, verifyAccessToken } from './tokens.js';

/** The cookie is how the browser authenticates; the header is for curl and the batch demos. */
function readToken(req) {
  const header = req.get('authorization');
  if (header?.startsWith('Bearer ')) return header.slice(7).trim();
  return req.cookies?.[ACCESS_COOKIE];
}

export function createRequireAuth({ accessSecret }) {
  return function requireAuth(req, res, next) {
    const payload = verifyAccessToken(readToken(req), accessSecret);
    if (!payload?.sub) {
      // The frontend reads this code to decide "refresh and retry once" rather than "log out".
      next(unauthorized('Session missing or expired.'));
      return;
    }
    req.user = { id: payload.sub, email: payload.email };
    next();
  };
}

export default createRequireAuth;
