/**
 * Request bodies are untrusted input like any other, so every one of them goes through zod before
 * a handler sees it. A failure names the field, because "invalid body" helps nobody.
 */
import { badRequest } from './errors.js';

/** @returns {object} the parsed body, with unknown keys stripped by the schema. */
export function parseBody(schema, body) {
  const result = schema.safeParse(body ?? {});
  if (!result.success) {
    throw badRequest(
      'The request body is not valid.',
      result.error.issues.map((issue) => ({
        field: issue.path.join('.') || '(body)',
        message: issue.message,
      })),
    );
  }
  return result.data;
}

/** Middleware form: validates and replaces `req.body`. */
export const validateBody = (schema) => (req, res, next) => {
  req.body = parseBody(schema, req.body);
  next();
};
