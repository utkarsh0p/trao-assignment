/**
 * The LLM adapter.
 *
 * One interface — `client.json()` — used by every pipeline step. The real client talks to Groq;
 * `fake.js` implements the same interface with fixture data so the pipeline can be tested without
 * a key or a network.
 *
 * Two rules from RULES.md live here:
 *   - every call goes through ONE shared rate limiter per process, not one per job or per step.
 *     Free tiers cap tokens per minute, and four parallel category calls will hit that.
 *   - the model's reply is parsed and validated against a zod schema before any step sees it.
 *
 * Importing this module must not require a key. `createGroqClient()` reads the environment; the
 * module does not. That is what keeps `npm run evaluate` runnable with only GROQ_API_KEY set and
 * the schema tests runnable with nothing set.
 */
import PQueue from 'p-queue';
import pRetry from 'p-retry';
import { repairUser } from './prompts.js';

const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';
const DEFAULT_MODEL = 'openai/gpt-oss-120b';

/**
 * `gpt-oss` thinks before it answers, and its reasoning is charged to the same `max_tokens` budget
 * as the reply. At the default effort more than half of a flashcards reply was reasoning, which
 * both truncated the JSON and burned through a tokens-per-minute allowance. These calls are
 * extraction and formatting, not puzzles, so the lowest setting is the right one: 27 reasoning
 * tokens instead of 532, and twice as fast.
 */
const DEFAULT_REASONING_EFFORT = 'low';
const REASONING_MODELS = /gpt-oss|o[1-9]|reasoning/i;

/**
 * The free tier's real limit is tokens per minute, not requests — 8000 TPM on the default model,
 * which one kit's worth of page text can reach on its own. Capping requests only smooths the
 * bursts; `Retry-After` below is what actually keeps a run alive.
 */
export const LIMITER_OPTIONS = { concurrency: 2, interval: 60_000, intervalCap: 14 };

/** Retries per call before giving up. Rate limits and 5xx are retried, bad requests are not. */
export const RETRIES = 5;

/** A token-per-minute window is 60 seconds, so waiting longer than one is never useful. */
export const MAX_RETRY_WAIT_MS = 65_000;

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * The free tier's ceiling, in tokens per minute. Overridable with GROQ_TPM, because it differs by
 * model and by account, and the run should be paced to whatever the account actually has.
 */
export const DEFAULT_TOKENS_PER_MINUTE = 8000;

/**
 * A token bucket, refilling continuously at the allowance.
 *
 * Counting requests is not enough. Four category calls carrying page text are a handful of
 * requests and several thousand tokens, and the provider measures the second number. This waits
 * for the budget to refill before a call goes out, which turns a burst that would earn a 429 into
 * a call that arrives a few seconds later and succeeds.
 *
 * `Retry-After` is still the backstop — this is an estimate, and the provider is the authority.
 */
export function createTokenBudget({ tokensPerMinute = DEFAULT_TOKENS_PER_MINUTE, now = Date.now } = {}) {
  const perMs = tokensPerMinute / 60_000;
  let available = tokensPerMinute;
  let lastRefill = now();

  function refill() {
    const timestamp = now();
    available = Math.min(tokensPerMinute, available + (timestamp - lastRefill) * perMs);
    lastRefill = timestamp;
  }

  return {
    /** Resolves once `tokens` of allowance exist, then spends them. */
    async take(tokens) {
      // A single call larger than the whole minute's allowance can never be satisfied. Charging
      // the full budget lets it through once the bucket is full, rather than hanging for ever.
      const wanted = Math.min(tokens, tokensPerMinute);
      for (;;) {
        refill();
        if (available >= wanted) {
          available -= wanted;
          return;
        }
        await delay(Math.ceil((wanted - available) / perMs));
      }
    },
    get remaining() {
      refill();
      return Math.floor(available);
    },
  };
}

/**
 * How much of a `max_tokens` reservation a reply actually uses. Measured, not guessed: a questions
 * call reserving 1800 comes back around 500-700 once reasoning is turned down.
 *
 * Reserving the full amount looks safe and is not — it paces the run three to four times slower
 * than the allowance really requires, which turns healthy cases into timeouts. The provider counts
 * the tokens a call actually spends, so the estimate should predict that, and `Retry-After`
 * catches the times it guesses low.
 */
export const COMPLETION_FACTOR = 0.45;

/**
 * What a call will cost, near enough to pace by: roughly four characters to a token for the
 * prompt, plus the share of the reservation a reply typically uses.
 */
export function estimateTokens({ system = '', user = '', maxTokens = 0 }) {
  return Math.ceil((system.length + user.length) / 4) + Math.ceil(maxTokens * COMPLETION_FACTOR);
}

/** Groq answers a 429 with the seconds to wait. Guessing an exponential backoff instead wastes it. */
function retryAfterMs(response) {
  const header = response.headers.get('retry-after');
  if (!header) return undefined;

  const seconds = Number(header);
  if (Number.isFinite(seconds)) return Math.min(seconds * 1000, MAX_RETRY_WAIT_MS);

  const date = Date.parse(header);
  return Number.isFinite(date) ? Math.min(Math.max(date - Date.now(), 0), MAX_RETRY_WAIT_MS) : undefined;
}

export class LlmError extends Error {
  constructor(message, options) {
    super(message, options);
    this.name = 'LlmError';
  }
}

/** The provider answered, but not with usable JSON. Carries the raw reply for the repair path. */
export class LlmOutputError extends LlmError {
  constructor(message, { raw, purpose, cause } = {}) {
    super(message, { cause });
    this.name = 'LlmOutputError';
    this.raw = raw;
    this.purpose = purpose;
  }
}

/** The request itself failed. `retryable` is false for anything retrying cannot fix. */
export class LlmRequestError extends LlmError {
  constructor(message, { status, retryable = true, retryAfterMs, cause } = {}) {
    super(message, { cause });
    this.name = 'LlmRequestError';
    this.status = status;
    this.retryable = retryable;
    /** How long the provider asked us to wait, when it said so. */
    this.retryAfterMs = retryAfterMs;
  }
}

/**
 * The one limiter. Module-level on purpose: two kits generating at once in the server share it,
 * and so do the concurrent cases in a batch run.
 */
let sharedLimiter;
export function getLimiter() {
  sharedLimiter ??= new PQueue(LIMITER_OPTIONS);
  return sharedLimiter;
}

/** The one token budget, shared for the same reason the limiter is. */
let sharedBudget;
export function getTokenBudget() {
  sharedBudget ??= createTokenBudget({
    tokensPerMinute: Number(process.env.GROQ_TPM) || DEFAULT_TOKENS_PER_MINUTE,
  });
  return sharedBudget;
}

/** Models like to wrap JSON in ```json fences however firmly they are asked not to. */
function stripFences(text) {
  const fenced = text.trim().match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return fenced ? fenced[1] : text.trim();
}

/**
 * Parses a model reply and validates it. Throws `LlmOutputError` with the raw text attached, which
 * is what the repair path needs.
 */
export function parseJsonReply(text, schema, purpose) {
  let data;
  try {
    data = JSON.parse(stripFences(text));
  } catch (cause) {
    throw new LlmOutputError(`${purpose}: reply was not JSON.`, { raw: text, purpose, cause });
  }

  const result = schema.safeParse(data);
  if (!result.success) {
    throw new LlmOutputError(`${purpose}: reply did not match the expected shape.`, {
      raw: text,
      purpose,
      cause: result.error,
    });
  }
  return result.data;
}

function retryableFromStatus(status) {
  // 429 and 5xx are worth another go. A 400 or a 401 will fail identically forever.
  return status === 429 || status >= 500;
}

/**
 * @param {{apiKey?: string, model?: string, fetchImpl?: typeof fetch, limiter?: PQueue}} options
 * @returns a client whose `json()` returns parsed, schema-valid data.
 */
export function createGroqClient({
  apiKey = process.env.GROQ_API_KEY,
  model = process.env.GROQ_MODEL || DEFAULT_MODEL,
  fetchImpl = fetch,
  limiter = getLimiter(),
  budget = getTokenBudget(),
  reasoningEffort = process.env.GROQ_REASONING_EFFORT || DEFAULT_REASONING_EFFORT,
  retryOptions = {},
} = {}) {
  if (!apiKey) {
    throw new LlmError('GROQ_API_KEY is not set. Get a free key at https://console.groq.com/keys');
  }

  async function request(body) {
    const response = await fetchImpl(GROQ_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      throw new LlmRequestError(`Groq returned ${response.status}. ${detail.slice(0, 200).trim()}`, {
        status: response.status,
        retryable: retryableFromStatus(response.status),
        retryAfterMs: retryAfterMs(response),
      });
    }

    const payload = await response.json();
    const content = payload?.choices?.[0]?.message?.content;
    if (typeof content !== 'string') {
      throw new LlmRequestError('Groq returned no message content.', { status: 200 });
    }
    return content;
  }

  return {
    name: 'groq',
    model,

    /**
     * @param {{purpose: string, system: string, user: string, schema: import('zod').ZodType,
     *          temperature?: number, maxTokens?: number}} call
     */
    async json({ purpose, system, user, schema, temperature = 0.2, maxTokens = 2048 }) {
      const body = {
        model,
        temperature,
        max_tokens: maxTokens,
        response_format: { type: 'json_object' },
        // Only sent to models that have the setting; anything else would reject the request.
        ...(REASONING_MODELS.test(model) && reasoningEffort
          ? { reasoning_effort: reasoningEffort }
          : {}),
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
      };

      const content = await limiter.add(async () => {
        // Wait for the tokens this call will spend before spending them.
        await budget.take(estimateTokens({ system, user, maxTokens }));

        return pRetry(() => request(body), {
          retries: RETRIES,
          shouldRetry: ({ error }) => error?.retryable !== false,
          // Wait exactly as long as we were told to before the next attempt. p-retry's own
          // backoff still applies on top, which is what handles a 5xx with no header.
          onFailedAttempt: async ({ error }) => {
            if (error?.retryAfterMs) await delay(error.retryAfterMs);
          },
          ...retryOptions,
        });
      });

      return parseJsonReply(content, schema, purpose);
    },
  };
}

/**
 * One call, with one repair attempt.
 *
 * A model that replies with prose, a truncated object or the wrong shape gets shown its own reply
 * and asked to correct it. If the second attempt is no better the error stands — RULES.md asks for
 * "retry with a repair prompt, then fail that step honestly rather than saving garbage", and this
 * is both halves of that.
 *
 * Every pipeline step goes through here rather than calling `client.json` directly.
 */
export async function requestJson(client, call) {
  try {
    return await client.json(call);
  } catch (error) {
    if (error?.name !== 'LlmOutputError' || call.noRepair) throw error;

    return client.json({
      ...call,
      purpose: `${call.purpose}:repair`,
      user: repairUser({ original: call.user, raw: error.raw, problem: error.message }),
    });
  }
}

export default createGroqClient;
