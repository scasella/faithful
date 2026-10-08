/**
 * The HTTP surface of one local session (route table: apps/ui/API.md). Mutating routes accept the job and return `{ok:true}`;
 * results arrive only as session events on the SSE stream, so the UI never shows something that is not an event.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { listExportedFunctions } from '@faithful/translate';
import { captureToolchain } from '@faithful/core';
import { openZ3, type Z3Driver } from '@faithful/smt';
import type { StampedEvent } from '@faithful/session';
import { smtChecker } from './smtChecker.js';
import { Optimizer, SessionRuntime, TestedOptimizer, deliver, deliverTested, type RulingInput } from './flow/index.js';
import type { ApiRoutes } from './server.js';
import { classifyFile, classifyFiles } from './flow/triage.js';
import { createTriagePool, type TriagePool } from './flow/triagePool.js';
import { RepoScanner } from './flow/scan.js';
import { listFiles } from './flow/files.js';

export { listFiles };

/** At most this many files per `POST /api/functions/status`. */
export const STATUS_MAX_FILES = 20;

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
  // Triage (which functions can run at all) runs in a small pool of worker threads (flow/triagePool.ts), started on first
  // use, each with a sandbox of its own: the server's thread never does the translating, compiling or loading, and the
  // loads never queue behind (or perturb the timings of) a session's job.
  let pool: TriagePool | null = null;
  const triagePool = (): TriagePool => (pool ??= createTriagePool());
  const triage = { get backend() { return triagePool(); } };
  // The background scan of the repository (flow/scan.ts), one per repository root; it waits while a session job runs.
  const scanners = new Map<string, RepoScanner>();
  const scannerFor = (root: string): RepoScanner => {
    let sc = scanners.get(root);
    if (!sc) {
      const p = triagePool();
      sc = new RepoScanner({ repoRoot: root, backend: p, capMs: p.capMs, concurrency: p.size, isBusy: () => rt.state.job.running !== null });
      scanners.set(root, sc);
    }
    return sc;
  };

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
    /** Which exported functions of one file can Faithful run (packages/cli/src/flow/triage.ts). Read-only, not a job. */
    'GET /api/functions/status': async ({ repoRoot: r, url }) => classifyFile(r, need(url.searchParams.get('file') ?? undefined, 'file'), triage),
    /** The same for up to STATUS_MAX_FILES files: { [file]: { [fn]: FunctionStatus } | null } (null: not readable). */
    'POST /api/functions/status': async ({ repoRoot: r, body }) => {
      const files = b(body).files;
      if (!Array.isArray(files) || !files.every((f) => typeof f === 'string' && f !== '')) throw Object.assign(new Error('files must be a list of paths'), { status: 400 });
      if (files.length > STATUS_MAX_FILES) throw Object.assign(new Error(`at most ${STATUS_MAX_FILES} files per request`), { status: 400 });
      return classifyFiles(r, files as string[], triage);
    },
    /**
     * The Pick list, ranked server-side over every exported function the background scan knows (flow/scan.ts): provable,
     * then testable, then not decided; never a function Faithful cannot run in `rows`. Starts the scan if none ran.
     */
    'POST /api/functions/pick': async ({ repoRoot: r, body }) => {
      const x = b(body);
      if (x.query !== undefined && typeof x.query !== 'string') throw Object.assign(new Error('query must be a string'), { status: 400 });
      if (x.limit !== undefined && (typeof x.limit !== 'number' || !Number.isFinite(x.limit))) throw Object.assign(new Error('limit must be a number'), { status: 400 });
      if (x.includeUnrunnable !== undefined && typeof x.includeUnrunnable !== 'boolean') throw Object.assign(new Error('includeUnrunnable must be true or false'), { status: 400 });
      return scannerFor(r).pick(((x.query as string | undefined) ?? '').slice(0, 200), { limit: x.limit as number | undefined, includeUnrunnable: x.includeUnrunnable === true });
    },
    /** Progress of the background scan: { state: 'idle' | 'running' | 'done', filesDone, filesTotal, version }. Cheap. */
    'GET /api/functions/scan': async ({ repoRoot: r }) => scannerFor(r).status(),
    /** Start a scan pass (idempotent: nothing while one runs or one finished a moment ago); answers the progress. */
    'POST /api/functions/scan/start': async ({ repoRoot: r }) => scannerFor(r).start(),
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
    /**
     * Can the Tested path run the open function (inputs from its signature, its file loaded in the sandbox for real)? Read-only,
     * not a job. The UI asks before offering the Tested tier for a refused function.
     */
    'GET /api/tested/check': async () => {
      if (!rt.state.fn) throw Object.assign(new Error('open a function first'), { status: 409 });
      const reason = await rt.testedBlocker();
      return reason === null ? { ok: true } : { ok: false, reason };
    },
    /** A refused function, continued on the Tested tier only (packages/cli/src/flow/tested.ts). */
    'POST /api/tested/start': async ({ body }) => {
      const x = b(body);
      const threshold = need(x.threshold as never, 'threshold');
      const tr = rt.state.translation;
      if (!tr || tr.ok) throw Object.assign(new Error('the Tested-only path is for a function the translator refused'), { status: 409 });
      return job('tested', async () => {
        abort = new AbortController();
        // a retry after a failed run keeps the recorded choice (tested.started is in the log once)
        if (!rt.state.tested) await rt.startTestedOnly({ specials: x.specials === true });
        else {
          // a retry runs the same preflight, so a file that cannot load fails with the plain reason, before any work
          const why = await rt.testedBlocker();
          if (why) throw new Error(why);
        }
        await new TestedOptimizer(rt, { threshold, signal: abort.signal }).run();
      });
    },
    'POST /api/deliver': async () => job('deliver', () => (rt.state.tested ? deliverTested(rt) : deliver(rt))),
    'GET /api/toolchain': async () => captureToolchain({ z3: z3?.info() ?? null }),
  };

  const clients = new Set<ServerResponse>();
  rt.subscribe((e: StampedEvent) => {
    // a job that ended lets a waiting scan carry on
    for (const sc of scanners.values()) sc.poke();
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
      // send the headers now: with no session yet there is nothing to write, and the page would say "Connecting…" until
      // the first keep-alive (15 s)
      res.flushHeaders();
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
      for (const sc of scanners.values()) sc.close();
      await pool?.close().catch(() => undefined);
      pool = null;
      for (const c of clients) c.end();
      await rt.close();
    },
  };
}
