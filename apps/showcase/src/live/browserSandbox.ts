/**
 * Browser port of packages/engine/src/sandbox/sandbox.ts (same public API), so the engine's differential tester
 * (`tsVsTs`), purity gate and the SMT package's counterexample replay run unchanged in the visitor's browser.
 * vite.config.ts redirects every import of the engine's `sandbox/sandbox.ts` to this file.
 *
 * Differences from the Node original, all forced by the platform:
 *  - one Web Worker (src/live/sandbox.worker.ts, which runs the engine's worker.ts unchanged) instead of a worker thread;
 *  - no V8 resourceLimits: a Web Worker's heap and stack cannot be capped from the page (a candidate that allocates
 *    without bound can exhaust the tab's memory);
 *  - watchdog heartbeat: the worker's index slot is not shared memory here, so the page cannot read it. The worker
 *    flushes results every 5 ms or 128 calls (engine worker.ts); the page treats the first not-yet-answered item as the
 *    call in progress and kills the worker when no result has arrived for `perCallMs`. A synchronous `while (true)` is
 *    therefore stopped after about perCallMs, as in Node.
 *
 * NOT a security boundary (as in Node): the mask catches accidental impurity, not a determined attacker.
 */
import type { Outcome, Val } from '@faithful/translate';
import type { PurityViolation } from '@faithful-engine-src/sandbox/mask.ts';
import type { CallResult, FromWorker, ToWorker } from '@faithful-engine-src/sandbox/protocol.ts';
import { prepareSource } from '@faithful-engine-src/sandbox/source.ts';
import SandboxWorker from './sandbox.worker.ts?worker';

export type { CallResult } from '@faithful-engine-src/sandbox/protocol.ts';

export interface SandboxOptions {
  memoryMb?: number;
  stackMb?: number;
  defaultTimeoutMs?: number;
  loadTimeoutMs?: number;
  startTimeoutMs?: number;
}
export interface LoadOptions {
  instrumented?: boolean;
}
export type LoadResult = { ok: true; ms: number } | { ok: false; error: string; violations: PurityViolation[] };
export interface BatchOptions {
  perCallMs?: number;
  totalMs?: number;
}
export interface BatchResult {
  results: CallResult[];
  timedOut: number[];
  notRun: number;
  respawns: number;
  ms: number;
}
export interface PurityReport {
  pure: boolean;
  violations: PurityViolation[];
  nondeterministic: Array<{ index: number; first: Outcome; second: Outcome }>;
  mutatedInputs: number[];
  outcomes: Outcome[];
}

interface LoadRecord {
  js: string;
  fnName: string;
  instrumented: boolean;
}

interface Handle {
  worker: Worker;
  listener: ((m: FromWorker) => void) | null;
  crash: ((detail: string) => void) | null;
  killed: boolean;
}

type Reply<T> = { kind: 'reply'; m: T } | { kind: 'timeout' } | { kind: 'crash'; detail: string };

const live = new Set<Worker>();
export function liveSandboxWorkers(): number {
  return live.size;
}

const now = (): number => performance.now();
const notRun = (detail: string): CallResult => ({ outcome: { tag: 'fault', detail }, violations: [], ms: 0 });

export class Sandbox {
  private readonly opts: Required<SandboxOptions>;
  private handle: Handle | null = null;
  private readonly loads = new Map<string, LoadRecord>();
  private tail: Promise<unknown> = Promise.resolve();
  private seq = 1;
  private closed = false;
  spawned = 0;
  /** Global names the browser prelude removed in the last spawned worker (for the About text and tests). */
  hardened: string[] = [];

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

  call(id: string, args: Val[], opts: { timeoutMs?: number } = {}): Promise<CallResult> {
    return this.enqueue(async () => {
      this.requireLoaded(id);
      const h = await this.ensure();
      const timeoutMs = opts.timeoutMs ?? this.opts.defaultTimeoutMs;
      const r = await this.exchange<Extract<FromWorker, { type: 'result' }>>(h, { type: 'call', seq: this.seq++, id, args }, timeoutMs);
      if (r.kind === 'reply') return r.m.result;
      if (r.kind === 'timeout') {
        this.kill(h);
        await this.ensure();
        return notRun('timeout');
      }
      await this.ensure();
      return notRun(r.detail);
    });
  }

  callBatch(id: string, argsList: Val[][], opts: BatchOptions = {}): Promise<BatchResult> {
    return this.enqueue(() => this.runBatch(id, argsList, opts));
  }

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
        if (a.violations.some((v) => v.kind === 'input-mutation') || b.violations.some((v) => v.kind === 'input-mutation')) mutatedInputs.push(i);
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

  async close(): Promise<void> {
    if (this.closed) return this.tail.then(() => undefined, () => undefined);
    this.closed = true;
    await this.tail.then(() => undefined, () => undefined);
    if (this.handle) this.kill(this.handle);
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
    const worker = new SandboxWorker({ name: 'faithful-sandbox' });
    this.spawned++;
    live.add(worker);
    const h: Handle = { worker, listener: null, crash: null, killed: false };
    worker.onmessage = (e: MessageEvent<FromWorker>) => h.listener?.(e.data);
    const onDeath = (detail: string): void => {
      live.delete(worker);
      if (this.handle === h) this.handle = null;
      if (!h.killed) {
        h.killed = true;
        worker.terminate();
        const c = h.crash;
        h.crash = null;
        c?.(detail);
      }
    };
    worker.onerror = (e: ErrorEvent) => {
      e.preventDefault();
      // An uncaught error in the worker (e.g. "Maximum call stack size exceeded" outside a call, out of memory).
      onDeath(`worker crashed: ${e.message || 'uncaught error'}`);
    };
    worker.onmessageerror = () => onDeath('worker crashed: unreadable message');
    return new Promise<Handle>((resolve, reject) => {
      const timer = setTimeout(() => {
        h.listener = null;
        h.crash = null;
        this.kill(h);
        reject(new Error(`sandbox worker did not start within ${this.opts.startTimeoutMs} ms`));
      }, this.opts.startTimeoutMs);
      h.listener = (m) => {
        if (m.type !== 'ready') return;
        clearTimeout(timer);
        this.hardened = m.hardened;
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

  private kill(h: Handle): void {
    h.killed = true;
    h.listener = null;
    h.crash = null;
    if (this.handle === h) this.handle = null;
    h.worker.terminate();
    live.delete(h.worker);
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
    if (r.kind === 'timeout') this.kill(h);
    return { ok: false, error: r.kind === 'timeout' ? 'timeout while evaluating the source' : r.detail, violations: [] };
  }

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
          // Heartbeat: the first item without a result is the call in progress (the worker runs items in order).
          let cursor = 0;
          const inProgress = (): number => {
            while (cursor < items.length && results[items[cursor]![0]] !== undefined) cursor++;
            return cursor < items.length ? items[cursor]![0] : items[items.length - 1]![0];
          };
          let lastChange = now();
          const tick = Math.max(1, Math.min(25, Math.floor(perCallMs / 4)));
          const finish = (x: Parameters<typeof resolve>[0]): void => {
            clearInterval(timer);
            h.listener = null;
            h.crash = null;
            resolve(x);
          };
          const timer = setInterval(() => {
            const t = now();
            if (t >= deadline) finish({ kind: 'timeout', index: inProgress(), budget: true });
            else if (t - lastChange > perCallMs) finish({ kind: 'timeout', index: inProgress(), budget: false });
          }, tick);
          h.listener = (m) => {
            if (!('seq' in m) || m.seq !== seq) return;
            if (m.type === 'chunk') {
              for (const [i, res] of m.items) results[i] = res;
              lastChange = now();
            } else if (m.type === 'batch-done') finish({ kind: 'done' });
            else if (m.type === 'error') finish({ kind: 'crash', index: inProgress(), detail: `sandbox protocol error: ${m.message}` });
          };
          h.crash = (detail) => finish({ kind: 'crash', index: inProgress(), detail });
          h.worker.postMessage({ type: 'batch', seq, id, items } satisfies ToWorker);
        },
      );
      if (r.kind === 'done') continue;
      if (r.kind === 'timeout') {
        this.kill(h);
        respawns++;
        if (results[r.index] === undefined) {
          results[r.index] = notRun('timeout');
          timedOut.push(r.index);
        }
        if (r.budget) budgetGone = true;
        continue;
      }
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
