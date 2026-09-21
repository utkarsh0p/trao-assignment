/**
 * The batch entry point's contract — what `npm run evaluate` reads in and what it writes out.
 * Shapes come from docs/PROJECT.md -> "The batch entry point".
 */
import { z } from 'zod';
import { KitSchema } from './kit.js';

/**
 * Codes used in a failed result — every one of them means no kit at all could be produced.
 *
 * `COMPANY_UNREACHABLE` is deliberately not emitted by the batch run. An unreachable site is a gap
 * carried into the kit, not a failed case (RULES.md), so a 404 company produces `ok` with the
 * reason in `kit.source.notes`. The code stays because the envelope documents it and a future
 * caller may have a stricter rule.
 */
export const ERROR_CODES = Object.freeze({
  COMPANY_UNREACHABLE: 'COMPANY_UNREACHABLE',
  /** The model could not produce usable output, after retries. */
  GENERATION_FAILED: 'GENERATION_FAILED',
  /** The case ran past its time budget and was abandoned so the rest of the run could finish. */
  CASE_TIMEOUT: 'CASE_TIMEOUT',
  /** A kit was produced but did not satisfy the schema, so it was thrown away rather than saved. */
  INVALID_KIT: 'INVALID_KIT',
  /** Anything unforeseen. Recorded rather than swallowed. */
  UNEXPECTED_ERROR: 'UNEXPECTED_ERROR',
});

export const CaseSchema = z.object({
  id: z.string().min(1),
  jd: z.string().min(1),
  company_url: z.url(),
  days: z.number().int().min(1),
});

export const CasesFileSchema = z.array(CaseSchema).min(1).superRefine((cases, ctx) => {
  const seen = new Set();
  cases.forEach((testCase, index) => {
    if (seen.has(testCase.id)) {
      ctx.addIssue({
        code: 'custom',
        path: [index, 'id'],
        message: `Duplicate case id "${testCase.id}".`,
      });
    }
    seen.add(testCase.id);
  });
});

export const BatchErrorSchema = z.object({
  code: z.string().min(1),
  message: z.string().min(1),
});

/**
 * `failed` is reserved for a case where no kit could be produced at all. A case that could only be
 * partially researched is `ok`, with the gaps recorded inside the kit — so the two states are
 * mutually exclusive in the envelope, not merely by convention.
 */
export const KitResultSchema = z.discriminatedUnion('status', [
  z.object({
    id: z.string().min(1),
    status: z.literal('ok'),
    kit: KitSchema,
    error: z.null(),
  }),
  z.object({
    id: z.string().min(1),
    status: z.literal('failed'),
    kit: z.null(),
    error: BatchErrorSchema,
  }),
]);

export const BatchOutputSchema = z.object({
  version: z.literal('1.0'),
  generated_at: z.iso.datetime({ offset: true }),
  kits: z.array(KitResultSchema),
});

export default BatchOutputSchema;
