/**
 * Replaying a counterexample: both functions run in the engine's sandbox, range-instrumented (so the candidate's own
 * range violations surface as `range-violation`, exactly as the original's would).
 */
import { INSTRUMENTED_ENTRY, Sandbox, instrumentedSandboxSource } from '@faithful/engine';
import type { Outcome, Translation, Val } from '@faithful/translate';

let seq = 0;

/** Outcomes of the instrumented `fns` on each input list. Opens (and closes) a sandbox unless one is given. */
export async function runInstrumented(
  fns: Translation[],
  inputs: Val[][],
  opts: { sandbox?: Sandbox; perCallMs?: number } = {},
): Promise<Outcome[][]> {
  const own = opts.sandbox ? null : await Sandbox.open();
  const sb = opts.sandbox ?? own!;
  try {
    const out: Outcome[][] = [];
    for (const t of fns) {
      const id = `smt-replay:${++seq}:${t.fnName}`;
      const l = await sb.load(id, instrumentedSandboxSource(t), INSTRUMENTED_ENTRY, { instrumented: true });
      if (!l.ok) {
        out.push(inputs.map(() => ({ tag: 'fault', detail: `did not load in the sandbox: ${l.error}` }) as Outcome));
        continue;
      }
      const r = await sb.callBatch(id, inputs, { perCallMs: opts.perCallMs ?? 2000 });
      out.push(r.results.map((x) => x.outcome));
      await sb.unload(id);
    }
    return out;
  } finally {
    if (own) await own.close();
  }
}
