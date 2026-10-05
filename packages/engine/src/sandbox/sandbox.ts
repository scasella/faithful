/**
 * Execution sandbox: one Node worker thread running candidate functions under the purity mask (mask.ts), driven from
 * the main thread with a wall-clock watchdog.
 *
 *  - `Sandbox.open()` spawns the worker (V8 `resourceLimits` cap heap and stack) and waits for it to harden itself.
 *  - `load(id, source, fnName)` transpiles TypeScript here (ts.transpileModule, exports stripped) and evaluates the JS
 *    in the worker's masked scope. The main thread keeps a record of every load, so a respawned worker is rebuilt from
 *    it.
 *  - `call` / `callBatch` enforce per-call and per-batch budgets. The worker publishes the index of the call in
 *    progress in a SharedArrayBuffer slot; the watchdog polls it. A synchronous loop can only be stopped by
 *    `worker.terminate()`, so on overrun the worker is killed (outcome `fault` / `timeout`), a new one is spawned and
 *    the loads are replayed. A worker that dies on its own (heap limit) gives `fault` / `out of memory`.
 *  - Arguments and results cross as JSON `Val`. Arguments are cloned per call in the worker and compared afterwards
 *    (input mutation is reported as a structured violation). `checkPurity` calls every sample input twice in a row
 *    and reports differing outcomes as `nondeterminism`.
 *  - Requests are serialized: one operation at a time per Sandbox.
 *
 * HONEST LIMIT: a worker thread with a watchdog is NOT a security boundary. It shares the process (and the file
 * system, environment and network stack) with the host; the mask shadows ambient globals and traps the known escapes
 * to the real global object, which catches accidental impurity in model-written or user-written code, not a
 * determined attacker. Run untrusted code in a separate OS process / container if that matters.
 */
import { Worker } from 'node:worker_threads';
import type { Outcome, Val } from '@faithful/translate';
import type { PurityViolation } from './mask.js';
import type { CallResult, FromWorker, ToWorker } from './protocol.js';
import { SLOT_INDEX } from './protocol.js';
import { prepareSource } from './source.js';

export type { CallResult } from './protocol.js';

export interface SandboxOptions {
  /** V8 old-generation heap limit for the worker, MB. Default 256. */
  memoryMb?: number;
  /** Worker stack size, MB. Default 4. */
  stackMb?: number;
  /** Per-call budget when a call passes none, ms. Default 2000. */
  defaultTimeoutMs?: number;
  /** Budget for evaluating a loaded source (top-level code), ms. Default 5000. */
  loadTimeoutMs?: number;
  /** Budget for a fresh worker to start and report ready, ms. Default 20000. */
  startTimeoutMs?: number;
}

export interface LoadOptions {
  /**
   * Instrumented (range-checked) mode. `__faithfulCheck(ok, detail)`, `__faithfulInt(value, detail)` and the class
   * `FaithfulRangeViolation` are injected into the function's scope; a thrown `FaithfulRangeViolation` (the injected
   * class, or any error whose `name` is `'FaithfulRangeViolation'`) becomes outcome `range-violation` with the error
   * message as detail. Outside instrumented mode such an error is an ordinary fault.
   */
  instrumented?: boolean;
}

export type LoadResult =
  | { ok: true; ms: number }
  | { ok: false; error: string; violations: PurityViolation[] };

export interface BatchOptions {
  /** Budget per call, ms. Default: the sandbox's defaultTimeoutMs. */
  perCallMs?: number;
  /** Budget for the whole batch, ms. Default: perCallMs * argsList.length + 10000. */
  totalMs?: number;
}

export interface BatchResult {
  /** One per input, in order. Inputs never run because the batch budget ran out are `fault` / `not run: ...`. */
  results: CallResult[];
  /** Indices that hit the per-call or batch budget. */
  timedOut: number[];
  notRun: number;
  /** Workers killed and respawned during this batch. */
  respawns: number;
  ms: number;
}

export interface PurityReport {
  /** True when no violation of any kind was seen (input mutation included). */
  pure: boolean;
  /** Deduplicated by kind + what, in first-seen order. */
  violations: PurityViolation[];
  /** Sample indices whose two consecutive calls disagreed. */
  nondeterministic: Array<{ index: number; first: Outcome; second: Outcome }>;
  /** Sample indices whose call mutated an argument. */
  mutatedInputs: number[];
  /** Outcome of the first call on each sample input. */
  outcomes: Outcome[];
}

interface LoadRecord {
  js: string;
  fnName: string;
  instrumented: boolean;
}

interface Handle {
  worker: Worker;
  slot: Int32Array;
  listener: ((m: FromWorker) => void) | null;
  /** Called once when the worker dies without being killed by us. */
  crash: ((detail: string) => void) | null;
  lastError: unknown;
  exited: Promise<void>;
  killed: boolean;
}

type Reply<T> = { kind: 'reply'; m: T } | { kind: 'timeout' } | { kind: 'crash'; detail: string };

const live = new Set<number>();

/** Number of sandbox worker threads that have been spawned and have not exited yet (all Sandboxes in this process). */
export function liveSandboxWorkers(): number {
  return live.size;
}

function workerEntry(): { url: URL; ts: boolean } {
  const here = import.meta.url;
  const ts = here.endsWith('.ts');
  return { url: new URL(ts ? './worker.ts' : './worker.js', here), ts };
}

/**
 * Running from TypeScript source (vitest): Node strips the worker's types itself, but the worker's relative imports are
 * written `./mask.js` (NodeNext convention). This bootstrap installs a resolve hook mapping a missing `./x.js` to
 * `./x.ts`, then imports the entry.
 */
const TS_BOOTSTRAP = `
const { registerHooks } = require('node:module');
registerHooks({
  resolve(specifier, context, nextResolve) {
    try { return nextResolve(specifier, context); }
    catch (e) {
      if (/^\\.\\.?\\//.test(specifier) && specifier.endsWith('.js')) return nextResolve(specifier.slice(0, -3) + '.ts', context);
      throw e;
    }
  },
});
import(require('node:worker_threads').workerData.entry).catch((e) => { throw e; });
`;

const now = (): number => performance.now();

function notRun(detail: string): CallResult {
  return { outcome: { tag: 'fault', detail }, violations: [], ms: 0 };
}

function crashDetail(err: unknown, code?: number): string {
  const c = (err as { code?: unknown } | null)?.code;
  if (c === 'ERR_WORKER_OUT_OF_MEMORY') return 'out of memory';
  if (err instanceof Error) return `worker crashed: ${err.message}`;
  return `worker exited (code ${code ?? '?'})`;
}

export class Sandbox {
  private readonly opts: Required<SandboxOptions>;
  private handle: Handle | null = null;
  private readonly loads = new Map<string, LoadRecord>();
  private tail: Promise<unknown> = Promise.resolve();
  private seq = 1;
  private closed = false;
  /** Workers spawned over this sandbox's lifetime (1 + respawns). */
  spawned = 0;

  private constructor(opts: SandboxOptions) {
    this.opts = {
      memoryMb: opts.memoryMb ?? 256,
      stackMb: opts.stackMb ?? 4,
      defaultTimeoutMs: opts.defaultTimeoutMs ?? 2000,
      loadTimeoutMs: opts.loadTimeoutMs ?? 5000,
      startTimeoutMs: opts.startTimeoutMs ?? 20000,
    };
  }

  static async open(opts: SandboxOptions = {}): Promise<Sandbox> {
    const sb = new Sandbox(opts);
    await sb.enqueue(() => sb.ensure());
    return sb;
  }

  /** Transpile `source` and evaluate it in the worker; `fnName` must be a function it declares. */
  load(id: string, source: string, fnName: string, opts: LoadOptions = {}): Promise<LoadResult> {
    return this.enqueue(async () => {
      const prepared = prepareSource(source);
      if (!prepared.ok) return { ok: false, error: prepared.error, violations: [] };
      const rec: LoadRecord = { js: prepared.js, fnName, instrumented: opts.instrumented ?? false };
      const t0 = now();
      const r = await this.loadInWorker(id, rec);
      if (r.ok) this.loads.set(id, rec);
      else this.loads.delete(id);
      return r.ok ? { ok: true, ms: now() - t0 } : r;
    });
  }

  unload(id: string): Promise<void> {
    return this.enqueue(async () => {
      this.loads.delete(id);
      const h = this.handle;
      if (h) await this.exchange(h, { type: 'unload', seq: this.seq++, id }, this.opts.loadTimeoutMs);
    });
  }

  /** Run one call. Never rejects for candidate behaviour; rejects only when `id` is not loaded or the sandbox is closed. */
  call(id: string, args: Val[], opts: { timeoutMs?: number } = {}): Promise<CallResult> {
    return this.enqueue(async () => {
      this.requireLoaded(id);
      const h = await this.ensure();
      const timeoutMs = opts.timeoutMs ?? this.opts.defaultTimeoutMs;
      const r = await this.exchange<Extract<FromWorker, { type: 'result' }>>(h, { type: 'call', seq: this.seq++, id, args }, timeoutMs);
      if (r.kind === 'reply') return r.m.result;
      if (r.kind === 'timeout') {
        await this.kill(h);
        await this.ensure();
        return notRun('timeout');
      }
      await this.ensure();
      return notRun(r.detail);
    });
  }

  /** Run many calls in one round trip, with a per-call and a whole-batch wall-clock budget. */
  callBatch(id: string, argsList: Val[][], opts: BatchOptions = {}): Promise<BatchResult> {
    return this.enqueue(() => this.runBatch(id, argsList, opts));
  }

  /**
   * Call every sample input twice in a row (fresh argument clones each time) and collect purity evidence: ambient /
   * intrinsic / global-write violations, input mutation, and outcomes that differ between the two calls.
   */
  checkPurity(id: string, sample: Val[][], opts: BatchOptions = {}): Promise<PurityReport> {
    return this.enqueue(async () => {
      const doubled: Val[][] = [];
      for (const a of sample) doubled.push(a, a);
      const batch = await this.runBatch(id, doubled, opts);
      const seen = new Set<string>();
      const violations: PurityViolation[] = [];
      const add = (v: PurityViolation): void => {
        const k = `${v.kind}\u0000${v.what}`;
        if (seen.has(k)) return;
        seen.add(k);
        violations.push(v);
      };
      const nondeterministic: PurityReport['nondeterministic'] = [];
      const mutatedInputs: number[] = [];
      const outcomes: Outcome[] = [];
      for (let i = 0; i < sample.length; i++) {
        const a = batch.results[2 * i]!;
        const b = batch.results[2 * i + 1]!;
        outcomes.push(a.outcome);
        for (const v of [...a.violations, ...b.violations]) add(v);
        if (a.violations.some((v) => v.kind === 'input-mutation') || b.violations.some((v) => v.kind === 'input-mutation')) {
          mutatedInputs.push(i);
        }
        const skip = (o: Outcome): boolean => o.tag === 'fault' && (o.detail === 'timeout' || o.detail.startsWith('not run'));
        if (skip(a.outcome) || skip(b.outcome)) continue;
        if (JSON.stringify(a.outcome) !== JSON.stringify(b.outcome)) {
          nondeterministic.push({ index: i, first: a.outcome, second: b.outcome });
          add({ kind: 'nondeterminism', what: `input ${i}: ${JSON.stringify(a.outcome)} then ${JSON.stringify(b.outcome)}` });
        }
      }
      return { pure: violations.length === 0, violations, nondeterministic, mutatedInputs, outcomes };
    });
  }

  /** Terminate the worker. Idempotent; later operations reject. */
  async close(): Promise<void> {
    if (this.closed) return this.tail.then(() => undefined, () => undefined);
    this.closed = true;
    const done = this.tail.then(
      () => undefined,
      () => undefined,
    );
    await done;
    if (this.handle) await this.kill(this.handle);
  }

  // ───────────────────────── internals ─────────────────────────

  private enqueue<T>(op: () => Promise<T>): Promise<T> {
    const run = this.tail.then(() => {
      if (this.closed) throw new Error('sandbox is closed');
      return op();
    });
    this.tail = run.catch(() => undefined);
    return run;
  }

  private requireLoaded(id: string): void {
    if (!this.loads.has(id)) throw new Error(`sandbox: no function loaded as '${id}'`);
  }

  private spawn(): Promise<Handle> {
    const sab = new SharedArrayBuffer(4);
    const slot = new Int32Array(sab);
    slot[SLOT_INDEX] = -1;
    const entry = workerEntry();
    const resourceLimits = {
      maxOldGenerationSizeMb: this.opts.memoryMb,
      maxYoungGenerationSizeMb: Math.min(64, Math.max(8, Math.floor(this.opts.memoryMb / 8))),
      stackSizeMb: this.opts.stackMb,
    };
    const worker = entry.ts
      ? new Worker(TS_BOOTSTRAP, { eval: true, workerData: { sab, entry: entry.url.href }, resourceLimits })
      : new Worker(entry.url, { workerData: { sab }, resourceLimits });
    this.spawned++;
    const tid = worker.threadId;
    live.add(tid);
    let resolveExit!: () => void;
    const exited = new Promise<void>((r) => (resolveExit = r));
    const h: Handle = { worker, slot, listener: null, crash: null, lastError: null, exited, killed: false };
    worker.on('message', (m: FromWorker) => h.listener?.(m));
    worker.on('error', (e) => {
      h.lastError = e;
    });
    worker.on('exit', (code) => {
      live.delete(tid);
      resolveExit();
      if (this.handle === h) this.handle = null;
      if (!h.killed) {
        const c = h.crash;
        h.crash = null;
        c?.(crashDetail(h.lastError, code));
      }
    });
    return new Promise<Handle>((resolve, reject) => {
      const timer = setTimeout(() => {
        h.listener = null;
        h.crash = null;
        void this.kill(h);
        reject(new Error(`sandbox worker did not start within ${this.opts.startTimeoutMs} ms`));
      }, this.opts.startTimeoutMs);
      h.listener = (m) => {
        if (m.type !== 'ready') return;
        clearTimeout(timer);
        h.listener = null;
        h.crash = null;
        resolve(h);
      };
      h.crash = (detail) => {
        clearTimeout(timer);
        reject(new Error(`sandbox worker failed to start: ${detail}`));
      };
    });
  }

  /** The live worker, spawning one and replaying every load if there is none. */
  private async ensure(): Promise<Handle> {
    if (this.handle) return this.handle;
    const h = await this.spawn();
    this.handle = h;
    for (const [id, rec] of this.loads) {
      const r = await this.loadInWorker(id, rec);
      if (!r.ok) throw new Error(`sandbox: replaying load of '${id}' in a respawned worker failed: ${r.error}`);
    }
    return h;
  }

  private async kill(h: Handle): Promise<void> {
    h.killed = true;
    h.listener = null;
    h.crash = null;
    if (this.handle === h) this.handle = null;
    await h.worker.terminate();
    await h.exited;
  }

  private async loadInWorker(id: string, rec: LoadRecord): Promise<LoadResult> {
    const h = await this.ensure();
    const seq = this.seq++;
    const r = await this.exchange<Extract<FromWorker, { type: 'loaded' }>>(
      h,
      { type: 'load', seq, id, js: rec.js, fnName: rec.fnName, instrumented: rec.instrumented },
      this.opts.loadTimeoutMs,
    );
    if (r.kind === 'reply') return r.m.ok ? { ok: true, ms: 0 } : { ok: false, error: r.m.error, violations: r.m.violations };
    if (r.kind === 'timeout') await this.kill(h);
    return { ok: false, error: r.kind === 'timeout' ? 'timeout while evaluating the source' : r.detail, violations: [] };
  }

  /** Post one request and wait for its single reply, the timeout, or the worker's death. */
  private exchange<T extends FromWorker>(h: Handle, msg: ToWorker, timeoutMs: number): Promise<Reply<T>> {
    return new Promise<Reply<T>>((resolve) => {
      const finish = (r: Reply<T>): void => {
        clearTimeout(timer);
        h.listener = null;
        h.crash = null;
        resolve(r);
      };
      const timer = setTimeout(() => finish({ kind: 'timeout' }), timeoutMs);
      h.listener = (m) => {
        if (!('seq' in m) || m.seq !== msg.seq) return;
        if (m.type === 'error') finish({ kind: 'crash', detail: `sandbox protocol error: ${m.message}` });
        else finish({ kind: 'reply', m: m as T });
      };
      h.crash = (detail) => finish({ kind: 'crash', detail });
      h.worker.postMessage(msg);
    });
  }

  private async runBatch(id: string, argsList: Val[][], opts: BatchOptions): Promise<BatchResult> {
    this.requireLoaded(id);
    const t0 = now();
    const n = argsList.length;
    const perCallMs = opts.perCallMs ?? this.opts.defaultTimeoutMs;
    const totalMs = opts.totalMs ?? perCallMs * n + 10_000;
    const deadline = t0 + totalMs;
    const results: Array<CallResult | undefined> = new Array(n);
    const timedOut: number[] = [];
    let respawns = 0;
    let budgetGone = false;

    while (!budgetGone) {
      const items: Array<[number, Val[]]> = [];
      for (let i = 0; i < n; i++) if (results[i] === undefined) items.push([i, argsList[i]!]);
      if (items.length === 0) break;
      if (now() >= deadline) break;
      const h = await this.ensure();
      const seq = this.seq++;
      const r = await new Promise<{ kind: 'done' } | { kind: 'timeout'; index: number; budget: boolean } | { kind: 'crash'; index: number; detail: string }>(
        (resolve) => {
          let lastIdx = -1;
          let lastChange = now();
          Atomics.store(h.slot, SLOT_INDEX, -1);
          const tick = Math.max(1, Math.min(25, Math.floor(perCallMs / 4)));
          const finish = (x: Parameters<typeof resolve>[0]): void => {
            clearInterval(timer);
            h.listener = null;
            h.crash = null;
            resolve(x);
          };
          const timer = setInterval(() => {
            const t = now();
            const idx = Atomics.load(h.slot, SLOT_INDEX);
            if (idx !== lastIdx) {
              lastIdx = idx;
              lastChange = t;
            }
            // Before the worker picks the batch up, slot is -1: charge that time to the first item.
            const cur = idx >= 0 ? idx : items[0]![0];
            if (t >= deadline) finish({ kind: 'timeout', index: cur, budget: true });
            else if (t - lastChange > perCallMs) finish({ kind: 'timeout', index: cur, budget: false });
          }, tick);
          h.listener = (m) => {
            if (!('seq' in m) || m.seq !== seq) return;
            if (m.type === 'chunk') for (const [i, res] of m.items) results[i] = res;
            else if (m.type === 'batch-done') finish({ kind: 'done' });
            else if (m.type === 'error') finish({ kind: 'crash', index: items[0]![0], detail: `sandbox protocol error: ${m.message}` });
          };
          h.crash = (detail) => {
            const idx = Atomics.load(h.slot, SLOT_INDEX);
            finish({ kind: 'crash', index: idx >= 0 ? idx : items[0]![0], detail });
          };
          h.worker.postMessage({ type: 'batch', seq, id, items } satisfies ToWorker);
        },
      );
      if (r.kind === 'done') continue;
      if (r.kind === 'timeout') {
        await this.kill(h);
        respawns++;
        if (results[r.index] === undefined) {
          results[r.index] = notRun('timeout');
          timedOut.push(r.index);
        }
        if (r.budget) budgetGone = true;
        continue;
      }
      // crash: the worker is gone already (exit handler cleared this.handle), unless it was a protocol error reply
      if (this.handle !== h) respawns++;
      if (results[r.index] === undefined) results[r.index] = notRun(r.detail);
    }

    let skipped = 0;
    for (let i = 0; i < n; i++) {
      if (results[i] === undefined) {
        results[i] = notRun('not run: batch budget exhausted');
        skipped++;
      }
    }
    if (!this.handle && !this.closed) await this.ensure();
    return { results: results as CallResult[], timedOut, notRun: skipped, respawns, ms: now() - t0 };
  }
}
