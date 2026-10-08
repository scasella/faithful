/**
 * Challenge search: run the spec (Lean `#eval`) and the original (instrumented, in the sandbox) on generated inputs
 * under the preconditions, boundary inputs first, and list every disagreement. Nothing proceeds while one remains.
 *
 * Inputs are generated under the preconditions WITHOUT the carve-outs, then the carve-outs drop what they exclude, so the
 * run can say how much of the generated input space the carve-outs took (`carvedOut` of `generatedBeforeCarveOuts`). When
 * carve-outs drop enough that fewer than `n` inputs remain, generation runs once more at a larger n (at most 4n).
 *
 * A spec outcome that is a fault (Lean produced no value: a timeout, a crash) is evidence about neither side. A whole
 * `evalBatch` file can time out as a unit, faulting inputs that evaluate fine alone, so faulted inputs are retried: first in
 * batches of 10, smallest inputs first, then, for a batch that still faults, one input at a time, so one slow input
 * cannot fault the inputs it shares a file with. Each retry call gets a tenth of the budget (an input that needs more than that alone stays a fault);
 * retry calls stop once they have used two full budgets of wall time. Whatever still faults is counted in `specFaults`
 * and never compared (and never listed as a disagreement); agreeBlocker refuses a run where these are at least as many as
 * the compared inputs.
 */
import {
  type Outcome,
  type Precondition,
  type Translation,
  type Val,
  leanEvalExpr,
  parseLeanOutcome,
} from '@faithful/translate';
import {
  INSTRUMENTED_ENTRY,
  Sandbox,
  compilePreconditions,
  generateInputs,
  instrumentedSandboxSource,
  outcomeEqual,
  type LeanEvaluator,
} from '@faithful/engine';
import { hashOf } from '@faithful/core';
import type { Challenge, ChallengeRun } from '@faithful/session';
import { specFile } from '@faithful/prover';

export interface ChallengeOptions {
  n: number;
  seed: number;
  throwChoice: 'precondition' | 'spec-case' | null;
  carveOuts: Precondition[];
  leanBudgetMs?: number;
  perCallMs?: number;
  /** Cap on listed disagreements (the total is still counted). */
  maxListed?: number;
}

export interface ChallengeResult {
  run: Omit<ChallengeRun, 'id' | 'specHash'> & {
    totalDisagreements: number;
    carveOutIds: string[];
    excluded: { range: number; throwPrecondition: number; faults: number; carvedOut: number; specFaults: number; generatedBeforeCarveOuts: number };
  };
}

/** The `#eval` line for `Spec.spec` on `args`: the translator's own printer with the function name swapped. */
export function specEvalExpr(t: Translation, args: Val[]): string {
  const e = leanEvalExpr(t, args);
  const needle = `(${t.lean.names.original}`;
  const i = e.indexOf(needle);
  if (i < 0) throw new Error('challenge: unexpected eval expression shape');
  return e.slice(0, i) + '(Spec.spec' + e.slice(i + needle.length);
}

function chunk<T>(xs: T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n));
  return out;
}

export async function challengeSearch(
  t: Translation,
  specLean: string,
  opts: ChallengeOptions,
  deps: { lean: LeanEvaluator; sandbox: Sandbox },
): Promise<ChallengeResult> {
  const t0 = performance.now();
  // generate under the preconditions only; the carve-outs (preconditions on KEPT inputs) are applied afterwards and counted
  const carvePreds = compilePreconditions(t.params, opts.carveOuts);
  const kept = (args: Val[]) => carvePreds.every((p) => p.test(args));
  const generate = (n: number) => {
    const g = generateInputs({ params: t.params, preconditions: t.preconditions }, { n, seed: opts.seed });
    return { gen: g, n, keep: g.inputs.map((_, k) => k).filter((k) => kept(g.inputs[k]!)) };
  };
  let pass = generate(opts.n);
  if (carvePreds.length && pass.keep.length < opts.n && !pass.gen.exhausted) {
    // carve-outs took part of the space: generate more so the compared count does not collapse (bounded)
    const scaled = pass.keep.length ? Math.ceil((opts.n * pass.gen.inputs.length) / pass.keep.length) : 4 * opts.n;
    pass = generate(Math.min(4 * opts.n, Math.max(opts.n + 1, scaled)));
  }
  const { gen, keep } = pass;
  const sb = deps.sandbox;
  const id = `challenge:${hashOf([t.fnName, t.source.hash]).slice(7, 19)}:${Math.random().toString(36).slice(2)}`;
  const loaded = await sb.load(id, instrumentedSandboxSource(t), INSTRUMENTED_ENTRY, { instrumented: true });
  if (!loaded.ok) throw new Error(`the original did not load in the sandbox: ${loaded.error}`);
  // outcomes of the original, by index into gen.inputs (carved-out inputs are never run)
  const outcomes = new Map<number, Outcome>();
  try {
    const res = (await sb.callBatch(id, keep.map((k) => gen.inputs[k]!), { perCallMs: opts.perCallMs ?? 1000 })).results;
    keep.forEach((k, j) => outcomes.set(k, res[j]!.outcome));
  } finally {
    await sb.unload(id);
  }
  const excluded = {
    range: 0,
    throwPrecondition: 0,
    faults: 0,
    carvedOut: gen.inputs.length - keep.length,
    specFaults: 0,
    generatedBeforeCarveOuts: gen.inputs.length,
  };
  const live: number[] = [];
  for (const k of keep) {
    const o = outcomes.get(k)!;
    if (o.tag === 'range-violation') excluded.range++;
    else if (o.tag === 'fault') excluded.faults++;
    else if (o.tag === 'throw' && opts.throwChoice === 'precondition') excluded.throwPrecondition++;
    else live.push(k);
  }
  const prelude = specFile(t, specLean);
  const budgetMs = opts.leanBudgetMs ?? 120_000;
  const specOutcomes = new Map<number, Outcome>();
  const evalSpec = async (ks: number[], ms = budgetMs) => {
    const r = await deps.lean.evalBatch(prelude, ks.map((k) => specEvalExpr(t, gen.inputs[k]!)), { budgetMs: ms });
    ks.forEach((k, j) => specOutcomes.set(k, r.errors.has(j) ? { tag: 'fault', detail: r.errors.get(j)! } : parseLeanOutcome(r.outputs[j])));
  };
  for (const part of chunk(live, 100)) await evalSpec(part);
  // retry spec faults (a batch-level timeout faults inputs that evaluate fine alone): batches of 10, then singly for a
  // batch that still faults, each call with a tenth of the budget; bounded by two budgets of wall time in all
  const retryMs = Math.max(1, Math.floor(budgetMs / 10));
  const retryStart = performance.now();
  const inTime = () => performance.now() - retryStart < 2 * budgetMs;
  const faulted = (ks: number[]) => ks.filter((k) => specOutcomes.get(k)!.tag === 'fault');
  // smallest inputs first (printed length): they are the likeliest to evaluate quickly, and batching them apart from
  // the large ones keeps a slow input from faulting them again
  const size = (k: number) => JSON.stringify(gen.inputs[k]).length;
  const retry = faulted(live).sort((a, b) => size(a) - size(b) || a - b);
  for (const part of chunk(retry, 10)) {
    if (!inTime()) break;
    await evalSpec(part, retryMs);
    if (part.length === 1) continue;
    for (const k of faulted(part)) {
      if (!inTime()) break;
      await evalSpec([k], retryMs);
    }
  }
  const disagreements: Challenge[] = [];
  let total = 0;
  let compared = 0;
  const boundaryCut = Math.max(1, Math.floor(pass.n / 3));
  for (const k of live) {
    const spec = specOutcomes.get(k)!;
    if (spec.tag === 'fault') {
      excluded.specFaults++;
      continue;
    }
    compared++;
    const original = outcomes.get(k)!;
    if (!outcomeEqual(spec, original)) {
      total++;
      if (disagreements.length < (opts.maxListed ?? 50)) {
        const input = gen.inputs[k]!;
        disagreements.push({ id: hashOf([input, spec, original]).slice(7, 19), input, spec, original, origin: k < boundaryCut ? 'boundary' : 'random' });
      }
    }
  }
  return {
    run: {
      inputsTried: gen.generated,
      inputsCompared: compared,
      disagreements,
      totalDisagreements: total,
      ms: performance.now() - t0,
      seed: opts.seed,
      carveOutIds: opts.carveOuts.map((c) => c.id),
      excluded,
    },
  };
}
