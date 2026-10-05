/**
 * One Z3 query per Web Worker (the page terminates the worker on timeout, as the Node WASM driver terminates its
 * worker thread). z3-solver 5.2.0's emscripten build (pthreads) is loaded from the site's own `z3/` folder:
 * `z3-built.js` is fetched and evaluated in this worker's global scope (works in Vite dev module workers and in the
 * built classic worker alike), then the package's low-level wrapper `init` is called with `locateFile` /
 * `mainScriptUrlOrBlob` pointing at the same folder so the pthread workers can load it too.
 *
 * Needs SharedArrayBuffer, i.e. a cross-origin-isolated page (measured: without it the first query throws
 * "pthread_create: environment does not support SharedArrayBuffer").
 */
import * as wrapper from 'z3-solver/build/low-level/wrapper.__GENERATED__.js';

interface Z3Low {
  mk_config(): number;
  mk_context(cfg: number): number;
  del_config(cfg: number): void;
  eval_smtlib2_string(ctx: number, s: string): Promise<string>;
}
const init = (wrapper as unknown as { init(m: unknown, o: unknown): Promise<{ Z3: Z3Low }> }).init;

self.onmessage = async (e: MessageEvent<{ base: string; smt2: string }>) => {
  const { base, smt2 } = e.data;
  const t0 = performance.now();
  try {
    const g = self as unknown as { initZ3?: unknown };
    if (!g.initZ3) {
      const src = await (await fetch(base + 'z3-built.js')).text();
      (0, eval)(src);
    }
    const { Z3 } = await init(g.initZ3, { locateFile: (f: string) => base + f, mainScriptUrlOrBlob: base + 'z3-built.js' });
    const initMs = performance.now() - t0;
    const cfg = Z3.mk_config();
    const ctx = Z3.mk_context(cfg);
    Z3.del_config(cfg);
    const t1 = performance.now();
    const out = await Z3.eval_smtlib2_string(ctx, smt2);
    self.postMessage({ ok: true, out, initMs, solveMs: performance.now() - t1 });
  } catch (err) {
    self.postMessage({ ok: false, error: String((err as Error)?.message ?? err), initMs: performance.now() - t0 });
  }
};
