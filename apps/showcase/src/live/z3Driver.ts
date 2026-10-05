/**
 * Browser Z3 driver with the shape of packages/smt/src/z3.ts `Z3Driver` (kind 'wasm'), so `verifiedToK` /
 * `checkEquivalent` run unchanged. Each solve runs in a fresh worker (src/live/z3.worker.ts) terminated on budget
 * expiry. Status parsing is the same as the Node driver's.
 */
import type { Z3Driver, SmtResult } from '@faithful-smt-src/z3.ts';
import Z3Worker from './z3.worker.ts?worker';

/** z3-solver version bundled with this site (vite.config.ts copies build/z3-built.{js,wasm} from this package). */
export const Z3_VERSION: string = __Z3_VERSION__;

function parseStatus(text: string): { status: SmtResult['status']; output: string } {
  const lines = text.split('\n');
  const i = lines.findIndex((l) => /^(sat|unsat|unknown)\s*$/.test(l.trim()));
  if (i < 0) return { status: /error/.test(text) ? 'error' : 'unknown', output: text };
  return { status: lines[i]!.trim() as 'sat' | 'unsat' | 'unknown', output: lines.slice(i + 1).join('\n').trim() };
}

export interface BrowserSolveTiming {
  initMs: number;
  solveMs: number;
  totalMs: number;
}

export function z3Base(): string {
  return new URL('z3/', document.baseURI).href;
}

/** Every query's timing, newest last (shown next to the SMT result). */
export const solveLog: Array<BrowserSolveTiming & { status: SmtResult['status'] }> = [];

export function runZ3(smt2: string, timeoutMs: number): Promise<SmtResult & { initMs: number }> {
  return new Promise((resolve) => {
    const t0 = performance.now();
    const w = new Z3Worker({ name: 'faithful-z3' });
    let done = false;
    const finish = (r: { status: SmtResult['status']; output: string }, initMs: number, solveMs: number): void => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      w.terminate();
      const totalMs = performance.now() - t0;
      solveLog.push({ status: r.status, initMs, solveMs, totalMs });
      resolve({ ...r, ms: totalMs, kind: 'wasm', initMs });
    };
    const timer = setTimeout(() => finish({ status: 'timeout', output: '' }, 0, 0), timeoutMs);
    w.onmessage = (e: MessageEvent<{ ok: boolean; out?: string; error?: string; initMs: number; solveMs?: number }>) => {
      const m = e.data;
      if (m.ok) finish(parseStatus(m.out ?? ''), m.initMs, m.solveMs ?? 0);
      else finish({ status: 'error', output: m.error ?? '' }, m.initMs, 0);
    };
    w.onerror = (e) => {
      e.preventDefault();
      finish({ status: 'error', output: e.message }, 0, 0);
    };
    w.postMessage({ base: z3Base(), smt2 });
  });
}

export function browserZ3(): Z3Driver {
  return {
    kind: 'wasm',
    version: Z3_VERSION,
    info: () => ({ kind: 'wasm', version: Z3_VERSION }),
    solve: (smt2, { timeoutMs }) => runZ3(smt2, timeoutMs),
  };
}

/** Can Z3 run here at all? (pthreads need SharedArrayBuffer, which needs cross-origin isolation.) */
export function z3Available(): { ok: boolean; why: string } {
  if (typeof SharedArrayBuffer === 'undefined' || !globalThis.crossOriginIsolated) {
    return { ok: false, why: 'this page is not cross-origin isolated, so SharedArrayBuffer (needed by the Z3 WASM build’s threads) is unavailable' };
  }
  return { ok: true, why: '' };
}
