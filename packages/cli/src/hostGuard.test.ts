import { describe, expect, it } from 'vitest';
import { request } from 'node:http';
import { guard } from './hostGuard.js';
import { startServer } from './server.js';

const TOKEN = 't0ken';

/** fetch() forbids overriding Host/Origin, so raw requests are needed to simulate a rebinding page. */
function raw(url: string, headers: Record<string, string>): Promise<number> {
  return new Promise((ok, bad) => {
    const r = request(url, { headers }, (res) => { res.resume(); ok(res.statusCode ?? 0); });
    r.on('error', bad);
    r.end();
  });
}
const base = { method: 'GET', host: '127.0.0.1:5000', origin: undefined, token: TOKEN, path: '/api/x' };

describe('same-host guard', () => {
  it('accepts loopback hosts on our port', () => {
    for (const host of ['127.0.0.1:5000', 'localhost:5000', '[::1]:5000']) expect(guard({ ...base, host }, 5000, TOKEN).ok).toBe(true);
  });
  it('refuses DNS-rebinding hosts and wrong ports', () => {
    for (const host of ['evil.example:5000', '127.0.0.1:5001', undefined, 'localhost.evil.com:5000']) {
      expect(guard({ ...base, host }, 5000, TOKEN).ok).toBe(false);
    }
  });
  it('refuses cross-origin and cross-site requests', () => {
    expect(guard({ ...base, origin: 'https://evil.example' }, 5000, TOKEN).ok).toBe(false);
    expect(guard({ ...base, origin: 'http://localhost:5000' }, 5000, TOKEN).ok).toBe(true);
    expect(guard({ ...base, secFetchSite: 'cross-site' }, 5000, TOKEN).ok).toBe(false);
  });
  it('requires the token on API routes only', () => {
    expect(guard({ ...base, token: undefined }, 5000, TOKEN)).toMatchObject({ ok: false, status: 401 });
    expect(guard({ ...base, token: 'wrong' }, 5000, TOKEN).ok).toBe(false);
    expect(guard({ ...base, token: undefined, path: '/' }, 5000, TOKEN).ok).toBe(true);
  });
});

describe('server', () => {
  it('binds loopback, serves a token, and enforces the guard end to end', async () => {
    const s = await startServer({ repoRoot: process.cwd() });
    try {
      expect(s.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/$/);
      const page = await fetch(s.url);
      expect(page.status).toBe(200);
      const noTok = await fetch(`${s.url}api/toolchain`);
      expect(noTok.status).toBe(401);
      const ok = await fetch(`${s.url}api/toolchain`, { headers: { 'x-faithful-token': s.token } });
      expect(ok.status).toBe(200);
      expect(((await ok.json()) as { node: string }).node).toMatch(/^v/);
      expect(await raw(`${s.url}api/toolchain`, { 'x-faithful-token': s.token, host: 'evil.example' })).toBe(403);
      expect(await raw(`${s.url}api/toolchain`, { 'x-faithful-token': s.token, origin: 'https://evil.example' })).toBe(403);
    } finally {
      await s.close();
    }
  });
});
