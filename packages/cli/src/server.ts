import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { dirname, extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkLean } from '@faithful/prover';
import { captureToolchain } from '@faithful/core';
import { guard, makeToken } from './hostGuard.js';
import { runDoctor } from './doctor.js';
import type { Api } from './api.js';

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json',
  '.woff2': 'font/woff2',
  '.png': 'image/png',
};

export interface RunningServer {
  server: Server;
  port: number;
  token: string;
  url: string;
  close(): Promise<void>;
}

export function uiDistDir(): string | null {
  const here = dirname(fileURLToPath(import.meta.url));
  for (let d = here, i = 0; i < 6; i++, d = dirname(d)) {
    const p = join(d, 'apps', 'ui', 'dist');
    if (existsSync(join(p, 'index.html'))) return p;
  }
  return null;
}

const FALLBACK_HTML = `<!doctype html><meta charset="utf-8"><title>Faithful</title><meta name="faithful-token" content="__TOKEN__">
<body style="font:16px system-ui;margin:3rem;max-width:40rem"><h1>Faithful</h1><p>The UI bundle is not built. Run <code>pnpm build</code>.</p>`;

async function readBody(req: IncomingMessage, limit = 4 * 1024 * 1024): Promise<string> {
  const chunks: Buffer[] = [];
  let n = 0;
  for await (const c of req) {
    n += (c as Buffer).length;
    if (n > limit) throw new Error('request body too large');
    chunks.push(c as Buffer);
  }
  return Buffer.concat(chunks).toString('utf8');
}

function send(res: ServerResponse, status: number, body: string | Buffer, type = 'application/json'): void {
  res.writeHead(status, {
    'content-type': type,
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer',
    'cross-origin-resource-policy': 'same-origin',
    'content-security-policy': "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'",
  });
  res.end(body);
}

export interface ServeOptions {
  port?: number;
  repoRoot: string;
  /** Extra API routes owned by workflow phases, mounted after the built-ins. */
  routes?: ApiRoutes;
  /** The session API (events stream + routes), when running the full app. */
  api?: Api;
}

export type ApiHandler = (req: { body: unknown; url: URL; repoRoot: string }) => Promise<unknown>;
export type ApiRoutes = Record<string, ApiHandler>; // key: "METHOD /api/path"

export async function startServer(opts: ServeOptions): Promise<RunningServer> {
  const token = makeToken();
  const dist = uiDistDir();
  let port = 0;
  const builtins: ApiRoutes = {
    'GET /api/doctor': async () => (await runDoctor()).checks,
    'GET /api/toolchain': async () => captureToolchain(),
    'POST /api/lean/check': async ({ body }) => {
      const b = body as { source?: unknown; theorems?: unknown; budgetMs?: unknown };
      if (typeof b.source !== 'string') throw new Error('source must be a string');
      const budget = typeof b.budgetMs === 'number' ? Math.min(Math.max(b.budgetMs, 1_000), 600_000) : 60_000;
      const theorems = Array.isArray(b.theorems) ? b.theorems.filter((t): t is string => typeof t === 'string' && /^[\w.']+$/.test(t)) : [];
      return checkLean({ source: b.source, theorems, budgetMs: budget });
    },
  };
  const routes: ApiRoutes = { ...builtins, ...opts.api?.routes, ...opts.routes };

  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'invalid'}`);
      const g = guard(
        {
          method: req.method ?? 'GET',
          host: req.headers.host,
          origin: req.headers.origin,
          secFetchSite: req.headers['sec-fetch-site'] as string | undefined,
          token: req.headers['x-faithful-token'] as string | undefined,
          path: url.pathname,
        },
        port,
        token,
      );
      if (!g.ok) return send(res, g.status, JSON.stringify({ error: g.reason }));

      if (url.pathname.startsWith('/api/')) {
        if (opts.api?.events(req, res, url)) return;
        const h = routes[`${req.method} ${url.pathname}`];
        if (!h) return send(res, 404, JSON.stringify({ error: 'no such route' }));
        const raw = req.method === 'POST' ? await readBody(req) : '';
        const body = raw ? JSON.parse(raw) : undefined;
        return send(res, 200, JSON.stringify(await h({ body, url, repoRoot: opts.repoRoot })));
      }
      if (req.method !== 'GET') return send(res, 405, JSON.stringify({ error: 'method not allowed' }));

      if (!dist) return send(res, 200, FALLBACK_HTML.replace('__TOKEN__', token), MIME['.html']);
      const rel = url.pathname === '/' ? 'index.html' : normalize(decodeURIComponent(url.pathname)).replace(/^[/\\]+/, '');
      const file = resolve(dist, rel);
      if (file !== dist && !file.startsWith(dist + sep)) return send(res, 403, 'forbidden', 'text/plain');
      let data: Buffer;
      try {
        data = await readFile(file);
      } catch {
        return send(res, 404, 'not found', 'text/plain');
      }
      if (rel === 'index.html') data = Buffer.from(data.toString('utf8').replace('__FAITHFUL_TOKEN__', token));
      return send(res, 200, data, MIME[extname(file)] ?? 'application/octet-stream');
    } catch (e) {
      return send(res, (e as { status?: number }).status ?? 500, JSON.stringify({ error: (e as Error).message }));
    }
  });

  await new Promise<void>((ok, bad) => {
    server.once('error', bad);
    server.listen(opts.port ?? 0, '127.0.0.1', () => ok()); // 127.0.0.1 only; never 0.0.0.0
  });
  const addr = server.address();
  port = typeof addr === 'object' && addr ? addr.port : 0;
  return {
    server,
    port,
    token,
    url: `http://127.0.0.1:${port}/`,
    close: async () => {
      await opts.api?.close();
      await new Promise<void>((ok) => { server.close(() => ok()); server.closeAllConnections(); });
    },
  };
}
