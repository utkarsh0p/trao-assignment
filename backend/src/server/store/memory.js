/**
 * The in-memory store. Same shape as `store/mongo.js`, no database.
 *
 * This is what the server tests run against. It is not a mock of the HTTP layer — the routes,
 * middleware, auth and job runner under test are the real ones; only the rows live in a Map. That
 * keeps the test suite installable from a clean clone with `npm install` and nothing else.
 *
 * Records are cloned on the way in and on the way out, so a caller holding a returned object
 * cannot mutate the stored one — which is exactly how Mongoose's `.lean()` behaves, and a test
 * that passes here for the wrong reason would be worthless.
 */
import { randomUUID } from 'node:crypto';
import { DuplicateEmailError, KIT_STATUSES } from './index.js';

const clone = (value) => (value === null || value === undefined ? value : structuredClone(value));

export function createMemoryStore({ now = () => new Date() } = {}) {
  const users = new Map();
  const refreshTokens = new Map();
  const kits = new Map();
  const practice = new Map();

  const put = (map, record) => {
    map.set(record.id, clone(record));
    return clone(record);
  };

  return {
    users: {
      async create({ email, name = '', passwordHash }) {
        const lower = String(email).toLowerCase();
        for (const user of users.values()) {
          if (user.email === lower) throw new DuplicateEmailError(email);
        }
        return put(users, {
          id: randomUUID(),
          email: lower,
          name,
          passwordHash,
          createdAt: now(),
          updatedAt: now(),
        });
      },
      async findByEmail(email) {
        const lower = String(email).toLowerCase();
        for (const user of users.values()) if (user.email === lower) return clone(user);
        return null;
      },
      async findById(id) {
        return clone(users.get(id) ?? null);
      },
    },

    refreshTokens: {
      async create(token) {
        return put(refreshTokens, { id: randomUUID(), createdAt: now(), ...token });
      },
      async findByJti(jti) {
        for (const token of refreshTokens.values()) if (token.jti === jti) return clone(token);
        return null;
      },
      async deleteByJti(jti) {
        for (const [id, token] of refreshTokens) {
          if (token.jti === jti) return refreshTokens.delete(id);
        }
        return false;
      },
      async deleteFamily(familyId) {
        let deleted = 0;
        for (const [id, token] of refreshTokens) {
          if (token.familyId === familyId && refreshTokens.delete(id)) deleted += 1;
        }
        return deleted;
      },
      async deleteForUser(userId) {
        let deleted = 0;
        for (const [id, token] of refreshTokens) {
          if (token.userId === userId && refreshTokens.delete(id)) deleted += 1;
        }
        return deleted;
      },
    },

    kits: {
      async create({ userId, input, idempotencyKey, status = KIT_STATUSES.QUEUED }) {
        const at = now();
        return put(kits, {
          id: randomUUID(),
          userId,
          status,
          input: clone(input),
          idempotencyKey,
          progress: [],
          kit: null,
          error: null,
          createdAt: at,
          updatedAt: at,
        });
      },
      async findById({ id, userId }) {
        const record = kits.get(id);
        if (!record || record.userId !== userId) return null;
        return clone(record);
      },
      async findByIdempotencyKey({ userId, idempotencyKey }) {
        for (const record of kits.values()) {
          if (record.userId === userId && record.idempotencyKey === idempotencyKey) {
            return clone(record);
          }
        }
        return null;
      },
      async listByUser(userId) {
        return [...kits.values()]
          .filter((record) => record.userId === userId)
          .sort((a, b) => b.createdAt - a.createdAt)
          .map(clone);
      },
      async update({ id, userId, patch }) {
        const record = kits.get(id);
        if (!record || (userId && record.userId !== userId)) return null;
        const updated = { ...record, ...clone(patch), updatedAt: now() };
        kits.set(id, updated);
        return clone(updated);
      },
      async touch(id) {
        const record = kits.get(id);
        if (record) kits.set(id, { ...record, updatedAt: now() });
      },
      async remove({ id, userId }) {
        const record = kits.get(id);
        if (!record || record.userId !== userId) return false;
        return kits.delete(id);
      },
    },

    practice: {
      async record({ userId, kitId, cardId, confidence, reviewedAt = now() }) {
        const key = `${userId}:${kitId}:${cardId}`;
        const existing = practice.get(key);
        const record = {
          id: existing?.id ?? randomUUID(),
          userId,
          kitId,
          cardId,
          confidence,
          reviewedAt,
        };
        practice.set(key, clone(record));
        return clone(record);
      },
      async listForKit({ userId, kitId }) {
        return [...practice.values()]
          .filter((record) => record.userId === userId && record.kitId === kitId)
          .map(clone);
      },
    },
  };
}

export default createMemoryStore;
