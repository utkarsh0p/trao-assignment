/**
 * The persistence boundary.
 *
 * Routes and the job runner talk to a `store`, never to Mongoose. Two implementations satisfy the
 * same shape: `store/mongo.js` is what runs, `store/memory.js` is what the tests run against, so
 * the HTTP layer is testable without a database and without downloading a mongod binary (STACK.md
 * rules out post-install binary downloads, and `mongodb-memory-server` is exactly that).
 *
 * Keeping Mongoose behind this line also keeps the "always scope by userId" rule enforceable in
 * one place: no store method can read a kit without being told whose it is.
 *
 * ── The shape ─────────────────────────────────────────────────────────────────────────────────
 *
 * user   { id, email, name, passwordHash, createdAt }
 * token  { id, jti, userId, familyId, tokenHash, expiresAt, createdAt }
 * kit    { id, userId, status, input: {jd, company_url, days}, idempotencyKey,
 *          progress: [{step, status, detail, at}], kit: object|null,
 *          error: {code, message}|null, createdAt, updatedAt }
 *
 * `status` is one of KIT_STATUSES. `kit` is the validated kit object from generateKit(), or null
 * while the job is still running.
 *
 *   store.users.create({email, name, passwordHash}) -> user           (throws DuplicateEmailError)
 *   store.users.findByEmail(email) -> user | null
 *   store.users.findById(id) -> user | null
 *
 *   store.refreshTokens.create({jti, userId, familyId, tokenHash, expiresAt}) -> token
 *   store.refreshTokens.findByJti(jti) -> token | null
 *   store.refreshTokens.deleteByJti(jti) -> boolean
 *   store.refreshTokens.deleteFamily(familyId) -> number
 *   store.refreshTokens.deleteForUser(userId) -> number
 *
 *   store.kits.create({userId, input, idempotencyKey}) -> kit
 *   store.kits.findById({id, userId}) -> kit | null
 *   store.kits.findByIdempotencyKey({userId, idempotencyKey}) -> kit | null
 *   store.kits.listByUser(userId) -> kit[]                      (newest first)
 *   store.kits.update({id, userId, patch}) -> kit | null        (patch is a shallow $set)
 *   store.kits.touch(id) -> void                                (heartbeat; moves updatedAt only)
 *   store.kits.remove({id, userId}) -> boolean
 *
 *   store.practice.record({userId, kitId, cardId, confidence}) -> record
 *   store.practice.listForKit({userId, kitId}) -> record[]
 */

/** The life of a generation job. `regenerating` keeps the existing kit readable while it reruns. */
export const KIT_STATUSES = Object.freeze({
  QUEUED: 'queued',
  RUNNING: 'running',
  REGENERATING: 'regenerating',
  READY: 'ready',
  FAILED: 'failed',
});

/** A job in one of these is still expected to be working, and is what staleness is judged against. */
export const ACTIVE_STATUSES = Object.freeze([
  KIT_STATUSES.QUEUED,
  KIT_STATUSES.RUNNING,
  KIT_STATUSES.REGENERATING,
]);

/** Raised by both implementations so the route does not have to know a Mongo error code. */
export class DuplicateEmailError extends Error {
  constructor(email) {
    super(`An account already exists for ${email}.`);
    this.name = 'DuplicateEmailError';
  }
}
