import { createRequire } from 'node:module';
import { Worker } from 'node:worker_threads';
import { findBinary, run, type Z3Info } from '@faithful/core';

export type Z3Kind = 'wasm' | 'system';

export interface SmtResult {
  /** First line of Z3's answer: `sat`, `unsat`, `unknown`, or `timeout` when our budget elapsed. */
  status: 'sat' | 'unsat' | 'unknown' | 'timeout' | 'error';
  /** Everything Z3 printed after the status line (model, reason-unknown, error text). */
  output: string;
  ms: number;
  kind: Z3Kind;
}

export interface Z3Driver {
  kind: Z3Kind;
  version: string;
  /** Run an SMT-LIB 2 script (which should end in `(check-sat)` and `(get-model)` or `(get-value ...)`). */
  solve(smt2: string, opts: { timeoutMs: number }): Promise<SmtResult>;
  info(): Z3Info;
}

const require_ = createRequire(import.meta.url);

/** The WASM build runs in a worker so a runaway query can be terminated; Z3's own timeout is not reliable in WASM. */
const WORKER_SRC = `
const { parentPort, workerData } = require('node:worker_threads');
(async () => {
  const { init } = require(workerData.entry);
  const { Z3 } = await init();
  const cfg = Z3.mk_config();
  const ctx = Z3.mk_context(cfg);
  Z3.del_config(cfg);
  const out = await Z3.eval_smtlib2_string(ctx, workerData.smt2);
  parentPort.postMessage({ ok: true, out });
})().catch((e) => parentPort.postMessage({ ok: false, error: String(e && e.message || e) }));
`;

function parseStatus(text: string): { status: SmtResult['status']; output: string } {
  const lines = text.split('\n');
  // Skip leading `success`-style noise; status is the first line that is one of the answers.
  const i = lines.findIndex((l) => /^(sat|unsat|unknown)\s*$/.test(l.trim()));
  if (i < 0) return { status: /error/.test(text) ? 'error' : 'unknown', output: text };
  return { status: lines[i]!.trim() as 'sat' | 'unsat' | 'unknown', output: lines.slice(i + 1).join('\n').trim() };
}

export async function openWasmZ3(): Promise<Z3Driver | null> {
  let entry: string;
  let version = 'unknown';
  try {
    entry = require_.resolve('z3-solver/build/node.js');
    version = (require_('z3-solver/package.json') as { version: string }).version;
  } catch {
    return null;
  }
  // Probe once so a broken WASM load falls back instead of failing at first use.
  const probe = await runWorker(entry, '(declare-const x Int)(assert (= x 1))(check-sat)', 30_000);
  if (probe.status !== 'sat') return null;
  return {
    kind: 'wasm',
    version,
    info: () => ({ kind: 'wasm', version }),
    solve: (smt2, { timeoutMs }) => runWorker(entry, smt2, timeoutMs),
  };
}

function runWorker(entry: string, smt2: string, timeoutMs: number): Promise<SmtResult> {
  return new Promise((resolve) => {
    const t0 = performance.now();
    const w = new Worker(WORKER_SRC, { eval: true, workerData: { entry, smt2 } });
    let done = false;
    const finish = (r: Omit<SmtResult, 'ms' | 'kind'>) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      void w.terminate();
      resolve({ ...r, ms: performance.now() - t0, kind: 'wasm' });
    };
    const timer = setTimeout(() => finish({ status: 'timeout', output: '' }), timeoutMs);
    w.on('message', (m: { ok: boolean; out?: string; error?: string }) => {
      if (m.ok) finish(parseStatus(m.out ?? ''));
      else finish({ status: 'error', output: m.error ?? '' });
    });
    w.on('error', (e) => finish({ status: 'error', output: String(e.message) }));
  });
}

export async function openSystemZ3(bin?: string): Promise<Z3Driver | null> {
  const path = await findBinary(bin ?? process.env.FAITHFUL_Z3_BIN ?? 'z3');
  if (!path) return null;
  const v = await run(path, ['--version'], { timeoutMs: 15_000 }).catch(() => null);
  const version = v?.stdout.match(/Z3 version (\S+)/)?.[1] ?? 'unknown';
  return {
    kind: 'system',
    version,
    info: () => ({ kind: 'system', version }),
    async solve(smt2, { timeoutMs }) {
      const r = await run(path, ['-in', '-smt2', `-T:${Math.max(1, Math.ceil(timeoutMs / 1000))}`], {
        input: smt2,
        timeoutMs: timeoutMs + 2_000,
      });
      if (r.timedOut) return { status: 'timeout', output: '', ms: r.ms, kind: 'system' };
      return { ...parseStatus(r.stdout), ms: r.ms, kind: 'system' };
    },
  };
}

/** WASM first (no install needed), then a system `z3`. Which one ran is recorded in every artifact. */
export async function openZ3(prefer: Z3Kind | 'auto' = 'auto'): Promise<Z3Driver> {
  const order: Z3Kind[] = prefer === 'system' ? ['system', 'wasm'] : ['wasm', 'system'];
  for (const k of order) {
    const d = k === 'wasm' ? await openWasmZ3() : await openSystemZ3();
    if (d) return d;
  }
  throw new Error('no Z3 available: `pnpm add z3-solver` (WASM) or install a system z3 (brew install z3)');
}
