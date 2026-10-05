/** Adapter from packages/smt to the optimizer's SmtChecker seam. */
import { translateWithIr } from '@faithful/translate';
import { verifiedToK, type Z3Driver } from '@faithful/smt';
import type { Sandbox } from '@faithful/engine';
import type { SmtChecker, SmtStageResult } from './flow/optimize.js';

export function smtChecker(z3: Z3Driver, sandbox?: Sandbox): SmtChecker {
  return {
    async check(original, originalFile, candidateSource, fnName, o): Promise<SmtStageResult> {
      const t0 = performance.now();
      const orig = translateWithIr(originalFile, original.fnName);
      const cand = translateWithIr(candidateSource, fnName);
      if (!orig.result.ok || !orig.ir) return { status: 'unsupported', detail: {}, note: 'the original has no IR', ms: performance.now() - t0 };
      if (!cand.result.ok || !cand.ir) {
        const why = cand.result.ok ? 'no IR' : cand.result.refusal.reason;
        return { status: 'unsupported', detail: {}, note: `no SMT check: the candidate is outside the verifiable subset (${why})`, ms: performance.now() - t0 };
      }
      const r = await verifiedToK({ translation: orig.result, ir: orig.ir }, { translation: cand.result, ir: cand.ir }, { budgetMs: o.budgetMs, z3, sandbox });
      const res = r.result;
      const detail = (r.detail ?? { stage: 'smt', k: res.k, bounds: res.bounds, budgetMs: o.budgetMs, z3: res.z3, result: res.status, encoding: res.encodingNote }) as unknown as Record<string, unknown>;
      const ms = performance.now() - t0;
      if (res.status === 'unsat') return { status: 'verified', k: res.k, detail, note: `Verified to k=${res.k}: ${res.encodingNote}`, ms };
      if (res.status === 'sat' && res.counterexample) {
        const c = res.counterexample;
        return { status: 'counterexample', k: res.k, detail, counterexample: { input: c.input, original: c.original, candidate: c.candidate }, note: `Z3 found an input where the candidate differs (k=${res.k})`, ms };
      }
      const status = res.status === 'unsupported' ? 'unsupported' : res.status === 'inconclusive' ? 'inconclusive' : res.status === 'timeout' ? 'timeout' : 'unknown';
      return { status, k: res.k, detail, note: res.reason ?? res.encodingNote, ms };
    },
  };
}
