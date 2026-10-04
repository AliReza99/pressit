import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { relative } from 'node:path';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { Hono } from 'hono';
import { createApp } from './app.js';

const port = Number(process.env.PORT ?? 8787);
// Bind to loopback only: this is a local tool and originals live in memory.
const hostname = process.env.HOST ?? '127.0.0.1';

const server = new Hono().route('/', createApp());

// After `pnpm build`, serve the web app from the same origin.
const webDist = fileURLToPath(new URL('../../web/dist', import.meta.url));
if (existsSync(webDist)) {
  const root = relative(process.cwd(), webDist) || '.';
  server.use('*', serveStatic({ root }));
  server.get('*', serveStatic({ root, path: 'index.html' }));
}

serve({ fetch: server.fetch, port, hostname }, info => {
  console.log(`pressit api listening on http://${info.address}:${info.port}`);
});
