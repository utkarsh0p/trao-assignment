#!/usr/bin/env node
/**
 * Serves fixtures/sites/ over http on :8099 so the crawler can be tested against real pages
 * without touching the open internet.
 *
 * Deliberately dependency-free: `node:http` and `node:fs` are enough for a handful of static
 * files, and the clean-clone install stays small.
 */
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(fileURLToPath(new URL('../fixtures/sites', import.meta.url)));
const PORT = Number(process.env.FIXTURES_PORT ?? 8099);

const CONTENT_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
};

/**
 * Maps a request path to a file inside ROOT, or null if it escapes ROOT or does not resolve.
 * A directory request falls back to its index.html.
 */
async function resolveFile(requestPath) {
  const decoded = decodeURIComponent(requestPath.split('?')[0]);
  const candidate = path.resolve(ROOT, `.${path.posix.normalize(decoded)}`);

  // Path traversal guard: whatever the request asked for, it has to land under ROOT.
  if (candidate !== ROOT && !candidate.startsWith(ROOT + path.sep)) return null;

  try {
    const stat = await fs.stat(candidate);
    if (stat.isDirectory()) {
      const index = path.join(candidate, 'index.html');
      await fs.access(index);
      return index;
    }
    return candidate;
  } catch {
    return null;
  }
}

function createFixturesServer() {
  return http.createServer(async (req, res) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('Method Not Allowed\n');
      return;
    }

  const file = await resolveFile(req.url ?? '/');
    if (!file) {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('Not Found\n');
      return;
    }

    const body = await fs.readFile(file);
    res.writeHead(200, {
      'content-type': CONTENT_TYPES[path.extname(file)] ?? 'application/octet-stream',
      'content-length': body.byteLength,
    });
    res.end(req.method === 'HEAD' ? undefined : body);
  });
}

/**
 * Starts the server and resolves with its base URL. Port 0 takes whatever is free, which is what
 * the crawler tests use so they never collide with a server already running on 8099.
 */
export function startFixtures({ port = PORT } = {}) {
  const server = createFixturesServer();
  return new Promise((resolve) => {
    server.listen(port, '127.0.0.1', () => {
      const { port: actual } = server.address();
      resolve({
        server,
        baseUrl: `http://127.0.0.1:${actual}`,
        close: () => new Promise((done) => server.close(done)),
      });
    });
  });
}

// Only listen when run as a command, so importing this in a test does not start a server.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { baseUrl } = await startFixtures();
  console.log(`fixtures: serving ${ROOT} on ${baseUrl}`);
}
