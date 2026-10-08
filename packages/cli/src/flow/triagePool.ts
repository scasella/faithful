/**
 * The triage worker pool: the Pick list's classification (translate, the Tested preflight with its synchronous compile
 * gate, the sandbox) runs in a few worker threads instead of the server's main thread, so the page's requests, the event
 * stream and a session's jobs are never queued behind it.
 *
 *  - `size` workers (default 2), started on first use; each owns its own `Sandbox` (./triageWorker.ts). One request is in
 *    flight per worker; the rest wait in two queues, 'high' (a request the user is waiting for) before 'low' (the
 *    background scan, ./scan.ts).
 *  - A watchdog on the main thread, not in the worker: the per-function cap timer lives in the worker's own event loop,
 *    which a synchronous compile gate on a huge file stalls. A worker that says nothing for `capMs + stallMs` (default
 *    cap + 20 s) is terminated and respawned; the function it was working on is 'unknown' ("took longer than ..."), the
 *    functions it had decided are kept, and the rest of the file is asked again on a fresh worker. A worker that dies
 *    (out of memory) is handled the same way, the function in progress being 'unknown' ("the check itself failed").
 *  - Workers run from the built `dist` (`triageWorker.js` next to this file) or, when this file is TypeScript source
 *    (vitest), from source through a resolve hook that maps `@faithful/*` to the workspace sources, so a test exercises the
 *    code under test and not a stale build. If workers cannot be started at all, the pool says so once on stderr and
 *    runs in this thread (`mode` 'inline'); `FAITHFUL_TRIAGE_THREADS=0` asks for that.
 */
import { availableParallelism } from 'node:os';
import { fileURLToPath } from 'node:url';
import { Worker } from 'node:worker_threads';
import { Sandbox } from '@faithful/engine';
import {
  DEFAULT_CAP_MS,
  TriageTimeout,
  failedStatus,
  getOwn,
  inlineBackend,
  mergeInto,
  newRecord,
  setOwn,
  slowStatus,
  type ClassifyItem,
  type FunctionStatus,
  type Priority,
  type QuickInfo,
  type TriageBackend,
} from './triage.js';
import type { FromWorker, ToWorker } from './triageProtocol.js';

export interface TriagePoolOptions {
  /** Worker threads (default 2, or `FAITHFUL_TRIAGE_WORKERS`). */
  size?: number;
  /** Per-function cap, ms (default 3000). */
  capMs?: number;
  /** Also run the original on the preflight's sample of generated inputs (default true). */
  sample?: boolean;
  /** Run in this thread (default: only when `FAITHFUL_TRIAGE_THREADS=0`). */
  inline?: boolean;
  /** A worker silent for `capMs + stallMs` is killed (default 20 000). */
  stallMs?: number;
  /**
   * How long a `quick` request may stay silent, ms (default 30 000). The worker signs of life every `QUICK_BEAT` functions,
   * so a file with thousands of functions is not mistaken for a stalled worker; one that is really stuck is killed after this.
   */
  quickMs?: number;
  /** V8 old-generation limit of a worker, MB (default 1024). */
  memoryMb?: number;
  /** The worker's entry module instead of ./triageWorker (tests: a worker that stalls or dies on cue). */
  entry?: URL;
  /**
   * Workers idle this long are ended, and started again on the next request (each holds a TypeScript compiler and a
   * sandbox: hundreds of MB). Default 60 000 ms, or `FAITHFUL_TRIAGE_IDLE_MS`; 0 keeps them.
   */
  idleMs?: number;
}

export interface TriagePool extends TriageBackend {
  readonly mode: 'workers' | 'inline';
  readonly size: number;
  readonly capMs: number;
  stats(): { mode: 'workers' | 'inline'; size: number; spawned: number; killed: number; crashed: number; retired: number; queued: number; inFlight: number };
}

/** Why a request to a worker did not finish. `decided` and `current` say how far a classify request got. */
class JobFailure extends Error {
  constructor(
    readonly kind: 'stalled' | 'crashed' | 'closed' | 'error',
    message: string,
    readonly decided: Record<string, FunctionStatus>,
    readonly current: string | null,
  ) {
    super(message);
  }
}

type Request = ToWorker extends infer T ? (T extends unknown ? Omit<T, 'id'> : never) : never;

interface Job {
  msg: Request;
  priority: Priority;
  id: number;
  timer: ReturnType<typeof setTimeout> | null;
  /** Silence the watchdog tolerates, ms. */
  silenceMs: number;
  decided: Record<string, FunctionStatus>;
  current: string | null;
  quick: QuickInfo | null;
  resolve(): void;
  reject(e: JobFailure): void;
}

interface Slot {
  worker: Worker | null;
  starting: Promise<boolean> | null;
  job: Job | null;
}

function inSource(): boolean {
  return import.meta.url.endsWith('.ts');
}

/**
 * Running from TypeScript source (vitest): the worker's relative imports are written `./x.js`, and `@faithful/*` must
 * mean the workspace sources, not the built packages. Node strips (or, with --experimental-transform-types, transforms)
 * the types itself. The engine's own sandbox worker uses the same trick for `./x.js`.
 */
const SOURCE_BOOTSTRAP = `
const { registerHooks } = require('node:module');
const { pathToFileURL } = require('node:url');
const { workerData } = require('node:worker_threads');
const root = workerData.root;
const subpaths = { '@faithful/core/tiers': 'packages/core/src/tiers.ts', '@faithful/session/node': 'packages/session/src/hash.ts' };
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (subpaths[specifier]) return nextResolve(pathToFileURL(root + '/' + subpaths[specifier]).href, context);
    const m = /^@faithful\\/([a-z]+)$/.exec(specifier);
    if (m) return nextResolve(pathToFileURL(root + '/packages/' + m[1] + '/src/index.ts').href, context);
    try { return nextResolve(specifier, context); }
    catch (e) {
      if (/^\\.\\.?\\//.test(specifier) && specifier.endsWith('.js')) return nextResolve(specifier.slice(0, -3) + '.ts', context);
      throw e;
    }
  },
});
import(workerData.entry).catch((e) => { throw e; });
`;

const START_MS = 30_000;

export function createTriagePool(opts: TriagePoolOptions = {}): TriagePool {
  const size = Math.max(1, Math.min(8, opts.size ?? (Number(process.env.FAITHFUL_TRIAGE_WORKERS) || Math.min(2, Math.max(1, availableParallelism() - 1)))));
  const capMs = opts.capMs ?? DEFAULT_CAP_MS;
  const sample = opts.sample ?? true;
  const stallMs = opts.stallMs ?? 20_000;
  const quickMs = opts.quickMs ?? 30_000;
  const memoryMb = opts.memoryMb ?? 1024;
  const idleMs = opts.idleMs ?? (process.env.FAITHFUL_TRIAGE_IDLE_MS !== undefined ? Number(process.env.FAITHFUL_TRIAGE_IDLE_MS) : 60_000);
  let inline = opts.inline ?? process.env.FAITHFUL_TRIAGE_THREADS === '0';
  let inlineImpl: TriageBackend | null = null;
  let sandbox: Promise<Sandbox> | null = null;
  const inlineBackendOnce = (): TriageBackend =>
    (inlineImpl ??= inlineBackend({
      sandbox: () => (sandbox ??= Sandbox.open().catch((e: unknown) => ((sandbox = null), Promise.reject(e)))),
      // a preflight past its cap was aborted with its sandbox: the next one opens a fresh one
      onAbandoned: () => {
        sandbox = null;
      },
      capMs,
      sample,
    }));

  const slots: Slot[] = Array.from({ length: size }, () => ({ worker: null, starting: null, job: null }));
  const queues: Record<Priority, Job[]> = { high: [], low: [] };
  let nextId = 1;
  let closed = false;
  let startFailures = 0;
  const counters = { spawned: 0, killed: 0, crashed: 0, retired: 0 };
  let idleTimer: ReturnType<typeof setTimeout> | null = null;

  /** (Re)start the idle clock: when nothing is queued or in flight for `idleMs`, the workers go away. */
  function touch(): void {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = null;
    if (closed || !(idleMs > 0)) return;
    idleTimer = setTimeout(() => {
      idleTimer = null;
      if (slots.some((s) => s.job) || queues.high.length || queues.low.length) return touch();
      for (const s of slots) {
        const w = s.worker;
        if (!w) continue;
        s.worker = null;
        counters.retired++;
        void w.terminate();
      }
    }, idleMs);
    idleTimer.unref?.();
  }

  function settleJob(slot: Slot, how: 'done' | { fail: JobFailure }): void {
    const job = slot.job;
    if (!job) return;
    if (job.timer) clearTimeout(job.timer);
    slot.job = null;
    if (how === 'done') job.resolve();
    else job.reject(how.fail);
    touch();
    pump();
  }

  function arm(slot: Slot): void {
    const job = slot.job;
    if (!job) return;
    if (job.timer) clearTimeout(job.timer);
    job.timer = setTimeout(() => {
      const w = slot.worker;
      slot.worker = null;
      counters.killed++;
      void w?.terminate();
      settleJob(slot, { fail: new JobFailure('stalled', 'the worker stopped answering', job.decided, job.current) });
    }, job.silenceMs);
    job.timer.unref?.();
  }

  function spawn(slot: Slot): Promise<boolean> {
    const src = inSource();
    const root = fileURLToPath(new URL('../../../../', import.meta.url));
    const entry = opts.entry ?? new URL(src ? './triageWorker.ts' : './triageWorker.js', import.meta.url);
    const resourceLimits = { maxOldGenerationSizeMb: memoryMb };
    let w: Worker;
    try {
      w = src
        ? new Worker(SOURCE_BOOTSTRAP, { eval: true, workerData: { entry: entry.href, root }, execArgv: ['--experimental-transform-types', '--no-warnings'], resourceLimits })
        : new Worker(entry, { resourceLimits });
    } catch {
      return Promise.resolve(false);
    }
    counters.spawned++;
    slot.worker = w;
    // a worker thread never keeps the process alive on its own (the server's own sockets do)
    w.unref();
    return new Promise<boolean>((resolve) => {
      let ready = false;
      const startTimer = setTimeout(() => {
        if (ready) return;
        if (slot.worker === w) slot.worker = null;
        void w.terminate();
        resolve(false);
      }, START_MS);
      startTimer.unref?.();
      w.on('message', (m: FromWorker) => {
        if (m.type === 'ready') {
          ready = true;
          clearTimeout(startTimer);
          resolve(true);
          return;
        }
        const job = slot.job;
        if (!job || slot.worker !== w || ('id' in m && m.id !== job.id)) return;
        arm(slot);
        if (m.type === 'start') job.current = m.name;
        else if (m.type === 'result') {
          job.decided[m.name] = m.status;
          job.current = null;
        } else if (m.type === 'done') {
          if (m.quick) job.quick = m.quick;
          settleJob(slot, 'done');
        } else if (m.type === 'fail') settleJob(slot, { fail: new JobFailure('error', m.error, job.decided, job.current) });
      });
      const gone = (why: string): void => {
        clearTimeout(startTimer);
        if (!ready) {
          if (slot.worker === w) slot.worker = null;
          resolve(false);
          return;
        }
        // a worker the watchdog or `close` already released (slot.worker moved on) has nothing in flight any more
        if (slot.worker !== w) return;
        slot.worker = null;
        if (slot.job) {
          counters.crashed++;
          settleJob(slot, { fail: new JobFailure('crashed', why, slot.job.decided, slot.job.current) });
        }
      };
      w.on('error', (e) => gone(e instanceof Error ? e.message : String(e)));
      w.on('exit', (code) => gone(`the worker exited (code ${code})`));
    });
  }

  async function dispatch(slot: Slot, job: Job): Promise<void> {
    const id = nextId++;
    job.id = id;
    slot.job = job;
    if (!slot.worker) {
      slot.starting ??= spawn(slot).finally(() => (slot.starting = null));
    }
    const ok = slot.starting ? await slot.starting : true;
    if (!slot.job || slot.job.id !== id) return; // settled meanwhile (closed)
    if (!ok || !slot.worker) {
      startFailures++;
      if (startFailures >= 2 && !inline) {
        inline = true;
        process.stderr.write('faithful: triage worker threads could not be started; classifying on the main thread instead\n');
      }
      settleJob(slot, { fail: new JobFailure('crashed', 'the worker could not be started', newRecord<FunctionStatus>(), null) });
      return;
    }
    startFailures = 0;
    arm(slot);
    slot.worker.postMessage({ ...job.msg, id } as ToWorker);
  }

  function pump(): void {
    if (closed) return;
    for (const slot of slots) {
      if (slot.job) continue;
      const job = queues.high.shift() ?? queues.low.shift();
      if (!job) return;
      void dispatch(slot, job);
    }
  }

  function run(msg: Request, priority: Priority, silenceMs: number): Promise<Job> {
    return new Promise<Job>((resolve, reject) => {
      if (closed) return reject(new JobFailure('closed', 'the triage pool is closed', newRecord<FunctionStatus>(), null));
      const job: Job = {
        msg,
        priority,
        id: 0,
        timer: null,
        silenceMs,
        decided: newRecord<FunctionStatus>(),
        current: null,
        quick: null,
        resolve: () => resolve(job),
        reject,
      };
      queues[priority].push(job);
      touch();
      pump();
    });
  }

  const backend: TriagePool = {
    get mode() {
      return inline ? 'inline' : 'workers';
    },
    size,
    capMs,
    async quick(text, o = {}) {
      if (inline) return inlineBackendOnce().quick(text, o);
      let lastError: unknown;
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          const job = await run({ op: 'quick', text }, o.priority ?? 'high', quickMs);
          if (job.quick) return job.quick;
          throw new Error('the worker answered without a result');
        } catch (e) {
          lastError = e;
          if (inline) return inlineBackendOnce().quick(text, o);
          // only a worker that died or could not start is worth asking again; one that stalled would stall again
          if (!(e instanceof JobFailure) || e.kind !== 'crashed') break;
        }
      }
      // a worker that kept silent for `quickMs` was killed: the file is too much for the cheap pass, and the caller says so
      if (lastError instanceof JobFailure && lastError.kind === 'stalled') throw new TriageTimeout(quickMs);
      throw lastError instanceof Error ? lastError : new Error(String(lastError));
    },
    async classify(text, items, o = {}) {
      if (inline) return inlineBackendOnce().classify(text, items, o);
      const out = newRecord<FunctionStatus>();
      let todo: ClassifyItem[] = items;
      for (let attempt = 0; todo.length && attempt < 6; attempt++) {
        try {
          const job = await run({ op: 'classify', text, items: todo, capMs, sample }, o.priority ?? 'high', capMs + stallMs);
          mergeInto(out, job.decided);
          todo = [];
        } catch (e) {
          if (!(e instanceof JobFailure)) break;
          mergeInto(out, e.decided);
          // the function in progress is the one that stalled or took the worker down
          if (e.current && getOwn(out, e.current) === undefined) setOwn(out, e.current, e.kind === 'stalled' ? slowStatus(capMs) : failedStatus());
          todo = todo.filter((i) => getOwn(out, i.name) === undefined);
          if (e.kind === 'closed') break;
          if (inline) {
            mergeInto(out, await inlineBackendOnce().classify(text, todo, o));
            todo = [];
          }
        }
      }
      // what could not be asked: the check itself failed
      for (const i of todo) if (getOwn(out, i.name) === undefined) setOwn(out, i.name, failedStatus());
      return out;
    },
    stats() {
      return { mode: inline ? 'inline' : 'workers', size, ...counters, queued: queues.high.length + queues.low.length, inFlight: slots.filter((s) => s.job).length };
    },
    async close() {
      if (closed) return;
      closed = true;
      if (idleTimer) clearTimeout(idleTimer);
      for (const q of [queues.high, queues.low]) for (const j of q.splice(0)) j.reject(new JobFailure('closed', 'the triage pool is closed', newRecord<FunctionStatus>(), null));
      await Promise.all(
        slots.map(async (s) => {
          if (s.job) settleJob(s, { fail: new JobFailure('closed', 'the triage pool is closed', s.job.decided, s.job.current) });
          const w = s.worker;
          s.worker = null;
          await w?.terminate();
        }),
      );
      await (await sandbox?.catch(() => null))?.close().catch(() => undefined);
      sandbox = null;
    },
  };
  // test hook: a synchronous stall inside a worker (resolves when it finishes or the watchdog kills the worker)
  Object.defineProperty(backend, '_spin', {
    enumerable: false,
    value: async (ms: number): Promise<'finished' | 'killed'> => {
      try {
        await run({ op: 'spin', ms }, 'high', Math.max(50, ms / 4));
        return 'finished';
      } catch {
        return 'killed';
      }
    },
  });
  return backend;
}
