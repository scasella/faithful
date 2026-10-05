/**
 * Challenge search: run the spec (Lean `#eval`) and the original (instrumented, in the sandbox) on generated inputs
 * under the preconditions, boundary inputs first, and list every disagreement. Nothing proceeds while one remains.
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
  run: Omit<ChallengeRun, 'id' | 'specHash'> & { totalDisagreements: number; carveOutIds: string[]; excluded: { range: number; throwPrecondition: number; faults: number; carvedOut: number } };
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
  const gen = generateInputs({ params: t.params, preconditions: [...t.preconditions, ...opts.carveOuts] }, { n: opts.n, seed: opts.seed });
  // carve-outs are preconditions on the kept inputs; count what they excluded for display
  const carvePreds = compilePreconditions(t.params, opts.carveOuts);
  const sb = deps.sandbox;
  const id = `challenge:${hashOf([t.fnName, t.source.hash]).slice(7, 19)}:${Math.random().toString(36).slice(2)}`;
  const loaded = await sb.load(id, instrumentedSandboxSource(t), INSTRUMENTED_ENTRY, { instrumented: true });
  if (!loaded.ok) throw new Error(`the original did not load in the sandbox: ${loaded.error}`);
  let outcomes: Outcome[];
  try {
    outcomes = (await sb.callBatch(id, gen.inputs, { perCallMs: opts.perCallMs ?? 1000 })).results.map((r) => r.outcome);
  } finally {
    await sb.unload(id);
  }
  const excluded = { range: 0, throwPrecondition: 0, faults: 0, carvedOut: 0 };
  const live: number[] = [];
  outcomes.forEach((o, k) => {
    if (o.tag === 'range-violation') excluded.range++;
    else if (o.tag === 'fault') excluded.faults++;
    else if (o.tag === 'throw' && opts.throwChoice === 'precondition') excluded.throwPrecondition++;
    else live.push(k);
  });
  void carvePreds;
  const prelude = specFile(t, specLean);
  const disagreements: Challenge[] = [];
  let total = 0;
  const boundaryCut = Math.max(1, Math.floor(opts.n / 3));
  for (const part of chunk(live, 100)) {
    const exprs = part.map((k) => specEvalExpr(t, gen.inputs[k]!));
    const r = await deps.lean.evalBatch(prelude, exprs, { budgetMs: opts.leanBudgetMs ?? 120_000 });
    part.forEach((k, j) => {
      const spec: Outcome = r.errors.has(j) ? { tag: 'fault', detail: r.errors.get(j)! } : parseLeanOutcome(r.outputs[j]);
      const original = outcomes[k]!;
      if (!outcomeEqual(spec, original)) {
        total++;
        if (disagreements.length < (opts.maxListed ?? 50)) {
          const input = gen.inputs[k]!;
          disagreements.push({ id: hashOf([input, spec, original]).slice(7, 19), input, spec, original, origin: k < boundaryCut ? 'boundary' : 'random' });
        }
      }
    });
  }
  return {
    run: {
      inputsTried: gen.generated,
      inputsCompared: live.length,
      disagreements,
      totalDisagreements: total,
      ms: performance.now() - t0,
      seed: opts.seed,
      carveOutIds: opts.carveOuts.map((c) => c.id),
      excluded,
    },
  };
}
