/**
 * Server-only configuration.
 *
 * STACK.md: "Validate the LLM key in the CLI entry point, and the database and auth secrets in the
 * server entry point. Never in a shared config module that demands all of them." This module is
 * the server half of that — `scripts/evaluate.js` never imports it, so a missing MONGODB_URI can
 * never stop the batch command from running.
 */

/** A secret shorter than this is not a secret. Both JWT secrets are checked against it. */
export const MIN_SECRET_LENGTH = 32;

const REQUIRED = ['MONGODB_URI', 'JWT_ACCESS_SECRET', 'JWT_REFRESH_SECRET'];

/**
 * Reads and checks everything the server needs, and nothing the pipeline needs.
 *
 * @param {NodeJS.ProcessEnv} source
 * @returns {{mongodbUri: string, accessSecret: string, refreshSecret: string, frontendUrl: string,
 *            port: number, isProduction: boolean}}
 */
export function readServerEnv(source = process.env) {
  const missing = REQUIRED.filter((name) => !source[name]);
  if (missing.length > 0) {
    throw new Error(
      `Missing server configuration: ${missing.join(', ')}. See backend/.env.example. ` +
        '(`npm run evaluate` does not need any of these.)',
    );
  }

  const isProduction = source.NODE_ENV === 'production';
  for (const name of ['JWT_ACCESS_SECRET', 'JWT_REFRESH_SECRET']) {
    if (source[name].length < MIN_SECRET_LENGTH) {
      throw new Error(
        `${name} is ${source[name].length} characters; use at least ${MIN_SECRET_LENGTH}. ` +
          'Generate one with: node -e "console.log(crypto.randomUUID()+crypto.randomUUID())"',
      );
    }
  }
  if (source.JWT_ACCESS_SECRET === source.JWT_REFRESH_SECRET) {
    throw new Error('JWT_ACCESS_SECRET and JWT_REFRESH_SECRET must be different secrets.');
  }

  return {
    mongodbUri: source.MONGODB_URI,
    accessSecret: source.JWT_ACCESS_SECRET,
    refreshSecret: source.JWT_REFRESH_SECRET,
    frontendUrl: source.FRONTEND_URL || 'http://localhost:3000',
    port: Number(source.PORT || 4000),
    isProduction,
  };
}

export default readServerEnv;
