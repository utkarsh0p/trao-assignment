/**
 * Tolerant zod shapes for model output.
 *
 * These are for the LLM boundary only — never for the kit contract, which stays strict. The
 * distinction: `KitSchema` is what we promise to save and serve, so it should reject anything
 * malformed. A model reply is a draft, and losing a whole kit because one cosmetic field came back
 * as `""` instead of `[]` is the wrong trade. Where the meaning is unambiguous, take it.
 *
 * Anything that could actually corrupt a kit — an id, a requirement reference — is still strict,
 * and unresolvable references are dropped by the step that receives them.
 */
import { z } from 'zod';

/**
 * An array of non-empty strings, however the model chose to express it. A bare string becomes a
 * one-element array; `""` and `null` become `[]`.
 */
export const stringArray = z
  .union([
    z.array(z.string()),
    z.string().transform((value) => (value.trim() ? [value] : [])),
    z.null().transform(() => []),
  ])
  .catch([])
  .transform((values) => values.map((value) => value.trim()).filter(Boolean));

/** A string, whatever shape of nothing arrived instead. */
export const looseString = z
  .union([z.string(), z.number().transform(String), z.null().transform(() => '')])
  .catch('');

/**
 * A reply that should be `{ key: [...] }`, however the model wrapped it.
 *
 * Asked for `{"flashcards": [...]}`, `gpt-oss` will sometimes send the bare array, and sometimes
 * name the key something else. Both are unambiguous when exactly one array is present, so both are
 * accepted.
 *
 * What this must NOT do is let a wrong shape look like an empty one. A schema of
 * `z.object({ flashcards: z.array(...).default([]) })` parses a bare array into zero flashcards
 * without complaining, which is how a kit came back with an empty deck and nothing in its notes to
 * say why. Anything this cannot recognise fails, and a failure reaches the repair path.
 */
export function listOf(key, item) {
  return z.preprocess((input) => {
    if (Array.isArray(input)) return { [key]: input };

    if (input && typeof input === 'object') {
      if (Array.isArray(input[key])) return input;

      // One array under some other name is still unambiguous. Two is a guess, so it fails.
      const arrays = Object.values(input).filter(Array.isArray);
      if (arrays.length === 1) return { [key]: arrays[0] };
    }

    return input;
  }, z.object({ [key]: z.array(item) }));
}
