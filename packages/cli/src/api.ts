/**
 * The HTTP surface of one local session (route table: apps/ui/API.md). Mutating routes accept the job and return `{ok:true}`;
 * results arrive only as session events on the SSE stream, so the UI never shows something that is not an event.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { readdir, readFile, stat } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { listExportedFunctions } from '@faithful/translate';
import { captureToolchain } from '@faithful/core';
import { openZ3, type Z3Driver } from '@faithful/smt';
import type { StampedEvent } from '@faithful/session';
import { smtChecker } from './smtChecker.js';
import { Optimizer, SessionRuntime, deliver, type RulingInput } from './flow/index.js';
import type { ApiRoutes } from './server.js';

const SKIP_DIRS = new Set(['node_modules', '.git', '.faithful', 'dist', 'build', 'coverage', '.next', 'out']);

export async function listFiles(repoRoot: string, max = 2000): Promise<Array<{ path: string; functions: Array<{ name: string; line: number; hasJsDoc: boolean }> }>> {
  const out: Array<{ path: string; functions: Array<{ name: string; line: number; hasJsDoc: boolean }> }> = [];
  async function walk(dir: string): Promise<void> {
    if (out.length >= max) return;
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (out.length >= max) return;
      const p = join(dir, e.name);
      if (e.isDirectory()) {
        if (!SKIP_DIRS.has(e.name) && !e.name.startsWith('.')) await walk(p);
      } else if (/\.(ts|mts)$/.test(e.name) && !/\.d\.ts$/.test(e.name) && !/\.(test|spec)\.ts$/.test(e.name)) {
        const st = await stat(p);
        if (st.size > 300_000) continue;
        const fns = listExportedFunctions(await readFile(p, 'utf8')).filter((f) => f.exported).map((f) => ({ name: f.name, line: f.line, hasJsDoc: f.hasJsDoc }));
        if (fns.length) out.push({ path: relative(repoRoot, p), functions: fns });
      }
    }
  }
  await walk(repoRoot);
  return out.sort((a, b) => a.path.localeCompare(b.path));
}

export interface Api {
  routes: ApiRoutes;
  /** Raw handler for the SSE stream; returns true when it handled the request. */
  events(req: IncomingMessage, res: ServerResponse, url: URL): boolean;
  runtime: SessionRuntime;
  close(): Promise<void>;
}

export async function createApi(repoRoot: string): Promise<Api> {
  let z3: Z3Driver | null = null;
  try {
    z3 = await openZ3();
  } catch {
    z3 = null;
  }
  const rt = new SessionRuntime({ repoRoot, z3: z3?.info() ?? null });
  if (z3) rt.smt = smtChecker(z3);
  let optimizer: Optimizer | null = null;
  let abort: AbortController | null = null;

  /** Queue a job; 423 when another is running. Failures become `job.failed` events, never silence. */
  const job = (name: string, fn: () => Promise<unknown>): { ok: true } => {
    if (rt.state.job.running) throw Object.assign(new Error(`another job is running (${rt.state.job.running})`), { status: 423 });
    void (async () => {
      await rt.emit({ kind: 'job.started', job: name });
      try {
        await fn();
        await rt.emit({ kind: 'job.finished', job: name });
      } catch (e) {
        await rt.emit({ kind: 'job.failed', job: name, message: (e as Error).message });
      }
    })();
    return { ok: true };
  };
  const need = <T>(v: T | undefined, what: string): T => {
    if (v === undefined || v === null || (typeof v === 'string' && v === '')) throw Object.assign(new Error(`${what} is required`), { status: 400 });
    return v;
  };
  const b = (x: unknown): Record<string, unknown> => (x && typeof x === 'object' ? (x as Record<string, unknown>) : {});

  const routes: ApiRoutes = {
    'GET /api/files': async ({ repoRoot: r }) => listFiles(r),
    'GET /api/session': async () => rt.state,
    'POST /api/session/open': async ({ body }) => {
      const x = b(body);
      const file = need(x.file as string, 'file');
      const fn = need(x.fn as string, 'fn');
      return job('open', () => rt.openFunction(file, fn));
    },
    'POST /api/session/paste': async ({ body }) => {
      const x = b(body);
      const source = need(x.source as string, 'source');
      const fn = (x.fn as string | undefined) ?? listExportedFunctions(source).find((f) => f.exported)?.name;
      return job('open', () => rt.pasteFunction(source, need(fn, 'fn')));
    },
    'POST /api/session/throw-choice': async ({ body }) => {
      const c = b(body).choice;
      if (c !== 'precondition' && c !== 'spec-case') throw Object.assign(new Error('choice must be "precondition" or "spec-case"'), { status: 400 });
      return job('throw-choice', () => rt.chooseThrow(c));
    },
    'POST /api/spec/propose': async () => job('spec-proposal', () => rt.proposeSpec()),
    'POST /api/spec/revise': async () => job('spec-revision', () => rt.reviseSpec()),
    'POST /api/challenge/rerun': async () => job('challenge', () => rt.rerunChallenge()),
    'GET /api/challenge/carve-options': async ({ url }) => rt.carveOptionsFor(need(url.searchParams.get('challengeId') ?? undefined, 'challengeId')),
    'POST /api/challenge/rule': async ({ body }) => {
      const x = b(body);
      const ruling = { ...(b(x.ruling) as object), challengeId: need(x.challengeId as string, 'challengeId') } as RulingInput;
      return job('ruling', () => rt.rule(ruling));
    },
    'POST /api/spec/agree': async () => {
      const blocker = rt.agreeBlocker();
      if (blocker) throw Object.assign(new Error(blocker), { status: 409 });
      return job('agree', () => rt.agree());
    },
    'POST /api/prove/original': async ({ body }) => {
      const bud = b(b(body).budget);
      const budget = { maxAttempts: Number(bud.maxAttempts) || 10, minutes: Number(bud.minutes) || 12 };
      return job('prove-original', () => rt.proveOriginal(budget));
    },
    'POST /api/optimize/start': async ({ body }) => {
      const threshold = b(body).threshold as never;
      return job('optimize', async () => {
        abort = new AbortController();
        optimizer = new Optimizer(rt, { threshold: need(threshold, 'threshold'), signal: abort.signal });
        await optimizer.run();
      });
    },
    'POST /api/optimize/accept-faster-not-proved': async ({ body }) => {
      const id = Number(b(body).candidateId);
      return job('accept', async () => {
        const o = optimizer ?? new Optimizer(rt, { threshold: { kind: 'time-budget', minutes: 1 } });
        await o.acceptFasterNotProved(id);
      });
    },
    'POST /api/optimize/stop': async () => {
      abort?.abort();
      return { ok: true };
    },
    'POST /api/deliver': async () => job('deliver', () => deliver(rt)),
    'GET /api/toolchain': async () => captureToolchain({ z3: z3?.info() ?? null }),
  };

  const clients = new Set<ServerResponse>();
  rt.subscribe((e: StampedEvent) => {
    const msg = `id: ${e.seq}\nevent: session\ndata: ${JSON.stringify(e)}\n\n`;
    for (const c of clients) c.write(msg);
  });

  return {
    routes,
    runtime: rt,
    events(req, res, url) {
      if (url.pathname !== '/api/session/events' || req.method !== 'GET') return false;
      const since = Number(url.searchParams.get('since') ?? 0) || 0;
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive', 'x-content-type-options': 'nosniff' });
      for (const e of rt.events) if (e.seq > since) res.write(`id: ${e.seq}\nevent: session\ndata: ${JSON.stringify(e)}\n\n`);
      clients.add(res);
      const ka = setInterval(() => res.write(': keep-alive\n\n'), 15_000);
      req.on('close', () => {
        clearInterval(ka);
        clients.delete(res);
      });
      return true;
    },
    async close() {
      abort?.abort();
      for (const c of clients) c.end();
      await rt.close();
    },
  };
}
