/**
 * One error type for anything the client should be told about, and one handler that turns it into
 * JSON. Everything else becomes a 500 with no detail — an internal message is for the log, not for
 * the response body.
 */

export class HttpError extends Error {
  /**
   * @param {number} status
   * @param {string} code  a stable machine-readable code the frontend can branch on
   * @param {string} message  safe to show a person
   */
  constructor(status, code, message, { cause, detail } = {}) {
    super(message, { cause });
    this.name = 'HttpError';
    this.status = status;
    this.code = code;
    this.detail = detail;
  }
}

export const badRequest = (message, detail) => new HttpError(400, 'BAD_REQUEST', message, { detail });
export const unauthorized = (message = 'Not signed in.') => new HttpError(401, 'UNAUTHORIZED', message);
export const forbidden = (message = 'Not allowed.') => new HttpError(403, 'FORBIDDEN', message);

/**
 * RULES.md: "Return 404 rather than 403 so the existence of other users' kits does not leak." A
 * kit belonging to someone else is indistinguishable from a kit that was never created.
 */
export const notFound = (message = 'Not found.') => new HttpError(404, 'NOT_FOUND', message);
export const conflict = (message, detail) => new HttpError(409, 'CONFLICT', message, { detail });

export function notFoundHandler(req, res, next) {
  next(new HttpError(404, 'NOT_FOUND', `No route for ${req.method} ${req.path}.`));
}

/**
 * Express 5 forwards rejected promises here on its own, so route handlers need no try/catch to
 * reach it.
 */
export function errorHandler(logger = console) {
  // eslint-disable-next-line no-unused-vars -- express identifies the error handler by arity
  return (error, req, res, next) => {
    if (error instanceof HttpError) {
      const body = { error: { code: error.code, message: error.message } };
      if (error.detail) body.error.detail = error.detail;
      res.status(error.status).json(body);
      return;
    }

    logger.error(`${req.method} ${req.path} failed:`, error);
    res.status(500).json({
      error: { code: 'INTERNAL_ERROR', message: 'Something went wrong on our side.' },
    });
  };
}
