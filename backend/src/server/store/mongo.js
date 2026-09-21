/**
 * The Mongoose implementation of the store described in `store/index.js`.
 *
 * Every model lives here, and every query leaves as a plain object (`.lean()`), so nothing outside
 * this file ever holds a Mongoose document. STACK.md: "generateKit() returns a plain object. Not a
 * Mongoose document."
 */
import mongoose from 'mongoose';
import { DuplicateEmailError, KIT_STATUSES } from './index.js';

const { Schema } = mongoose;

const UserSchema = new Schema(
  {
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    name: { type: String, default: '' },
    passwordHash: { type: String, required: true },
  },
  { timestamps: true },
);

/**
 * The refresh token itself is never stored — only a SHA-256 of it, against its `jti`. A leaked
 * database gives an attacker nothing to present at /auth/refresh.
 *
 * `familyId` is what makes reuse detection possible: every token rotated from the same login
 * shares it, so presenting an already-rotated token can revoke the whole family at once.
 */
const RefreshTokenSchema = new Schema(
  {
    jti: { type: String, required: true, unique: true },
    userId: { type: String, required: true, index: true },
    familyId: { type: String, required: true, index: true },
    tokenHash: { type: String, required: true },
    // Mongo deletes the row when it expires, so revocation state cannot grow without bound.
    expiresAt: { type: Date, required: true, expires: 0 },
  },
  { timestamps: true },
);

const KitSchema = new Schema(
  {
    userId: { type: String, required: true, index: true },
    status: {
      type: String,
      required: true,
      enum: Object.values(KIT_STATUSES),
      default: KIT_STATUSES.QUEUED,
    },
    input: {
      jd: { type: String, required: true },
      company_url: { type: String, required: true },
      days: { type: Number, required: true },
    },
    idempotencyKey: { type: String, required: true },
    progress: { type: [Schema.Types.Mixed], default: [] },
    /**
     * The kit itself, stored as given. It has already been through KitSchema.parse() — validating
     * it a second time in Mongoose would mean maintaining the contract in two places, and the zod
     * schema is the one PROJECT.md names.
     */
    kit: { type: Schema.Types.Mixed, default: null },
    error: { type: Schema.Types.Mixed, default: null },
  },
  { timestamps: true, minimize: false },
);

// Two submissions of the same posting to the same company by the same user are one job.
KitSchema.index({ userId: 1, idempotencyKey: 1 }, { unique: true });
KitSchema.index({ userId: 1, createdAt: -1 });

const PracticeRecordSchema = new Schema(
  {
    userId: { type: String, required: true },
    kitId: { type: String, required: true },
    cardId: { type: String, required: true },
    /** 1–3, lowest first in the next session. */
    confidence: { type: Number, required: true, min: 1, max: 3 },
    reviewedAt: { type: Date, required: true, default: () => new Date() },
  },
  { timestamps: true },
);

PracticeRecordSchema.index({ userId: 1, kitId: 1, cardId: 1 }, { unique: true });

export const models = {
  User: mongoose.models.User ?? mongoose.model('User', UserSchema),
  RefreshToken: mongoose.models.RefreshToken ?? mongoose.model('RefreshToken', RefreshTokenSchema),
  Kit: mongoose.models.Kit ?? mongoose.model('Kit', KitSchema),
  PracticeRecord:
    mongoose.models.PracticeRecord ?? mongoose.model('PracticeRecord', PracticeRecordSchema),
};

const DUPLICATE_KEY = 11000;

/** `_id` is a detail of this implementation; everything above the store sees `id`. */
function withId(doc) {
  if (!doc) return null;
  const { _id, __v, ...rest } = doc;
  return { id: String(_id), ...rest };
}

export function createMongoStore({ models: m = models } = {}) {
  return {
    users: {
      async create({ email, name = '', passwordHash }) {
        try {
          const doc = await m.User.create({ email, name, passwordHash });
          return withId(doc.toObject());
        } catch (error) {
          if (error?.code === DUPLICATE_KEY) throw new DuplicateEmailError(email);
          throw error;
        }
      },
      async findByEmail(email) {
        return withId(await m.User.findOne({ email: String(email).toLowerCase() }).lean());
      },
      async findById(id) {
        if (!mongoose.isValidObjectId(id)) return null;
        return withId(await m.User.findById(id).lean());
      },
    },

    refreshTokens: {
      async create(token) {
        return withId((await m.RefreshToken.create(token)).toObject());
      },
      async findByJti(jti) {
        return withId(await m.RefreshToken.findOne({ jti }).lean());
      },
      async deleteByJti(jti) {
        return (await m.RefreshToken.deleteOne({ jti })).deletedCount > 0;
      },
      async deleteFamily(familyId) {
        return (await m.RefreshToken.deleteMany({ familyId })).deletedCount;
      },
      async deleteForUser(userId) {
        return (await m.RefreshToken.deleteMany({ userId })).deletedCount;
      },
    },

    kits: {
      async create({ userId, input, idempotencyKey, status = KIT_STATUSES.QUEUED }) {
        const doc = await m.Kit.create({ userId, input, idempotencyKey, status });
        return withId(doc.toObject());
      },
      // Scoped in the query itself, never fetched and then compared (RULES.md).
      async findById({ id, userId }) {
        if (!mongoose.isValidObjectId(id)) return null;
        return withId(await m.Kit.findOne({ _id: id, userId }).lean());
      },
      async findByIdempotencyKey({ userId, idempotencyKey }) {
        return withId(await m.Kit.findOne({ userId, idempotencyKey }).lean());
      },
      async listByUser(userId) {
        const docs = await m.Kit.find({ userId }).sort({ createdAt: -1 }).lean();
        return docs.map(withId);
      },
      async update({ id, userId, patch }) {
        if (!mongoose.isValidObjectId(id)) return null;
        const filter = userId ? { _id: id, userId } : { _id: id };
        return withId(await m.Kit.findOneAndUpdate(filter, { $set: patch }, { new: true }).lean());
      },
      /** The heartbeat. `updatedAt` moving is the whole point, so the patch is empty on purpose. */
      async touch(id) {
        if (!mongoose.isValidObjectId(id)) return;
        await m.Kit.updateOne({ _id: id }, { $set: { updatedAt: new Date() } }, { timestamps: false });
      },
      async remove({ id, userId }) {
        if (!mongoose.isValidObjectId(id)) return false;
        return (await m.Kit.deleteOne({ _id: id, userId })).deletedCount > 0;
      },
    },

    practice: {
      async record({ userId, kitId, cardId, confidence, reviewedAt = new Date() }) {
        const doc = await m.PracticeRecord.findOneAndUpdate(
          { userId, kitId, cardId },
          { $set: { confidence, reviewedAt } },
          { new: true, upsert: true },
        ).lean();
        return withId(doc);
      },
      async listForKit({ userId, kitId }) {
        const docs = await m.PracticeRecord.find({ userId, kitId }).lean();
        return docs.map(withId);
      },
    },
  };
}

/** Connects, and fails loudly rather than letting the first request discover there is no database. */
export async function connectDatabase(uri, options = {}) {
  mongoose.set('strictQuery', true);
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 10_000, ...options });
  return mongoose.connection;
}

export default createMongoStore;
