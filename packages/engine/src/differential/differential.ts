/**
 * Differential testing.
 *
 * `tsVsLean(translation, opts, deps)`: the translator's own conformance check. Inputs come from `generate.ts`
 * (seeded; `ts` preconditions applied by rejection). For every input:
 *   1. the range-instrumented original runs in the sandbox (instrumented mode, see instrumented.ts), and the plain
 *      original runs too; whenever the instrumented run is not a range violation the two must agree exactly
 *      (otherwise: an `instrumentation` disagreement, i.e. the instrumentation changed behaviour);
 *   2. inputs on which the TypeScript side faults (timeout, stack overflow, non-literal error) are NOT sent to Lean:
 *      a fault is never agreement, and the same input would usually make the Lean evaluation run as long (the Lean
 *      model is total, but e.g. a loop over 2^53 iterations still takes 2^53 steps); they are counted (`tsFaults`);
 *   3. one Lean process evaluates, for each remaining input, `Model.<fn>_rangeOk`, `_asciiOk` (when an `ascii`
 *      precondition exists) and `_pre`, and, ONLY on inputs where the instrumented original returned or threw, the
 *      model itself (`leanEvalExpr`). The model is not run on range-violating inputs: nothing stops it there (the
 *      checks live in the `_chk` twin), so a range-violating input can be arbitrarily expensive for the model;
 *   4. comparisons:
 *        - `range-ok`: TS range-violation with detail `range|bounds|nonzero ...`  <=>  Lean rangeOk = false (and pre =
 *          false); detail `ascii ...`  <=>  asciiOk = false (and pre = false); no violation  <=>  rangeOk, asciiOk and pre
 *          all true. Any mismatch is a translator bug (`range-ok` disagreement);
 *        - `outcome`: on inputs where TS returned or threw, the Lean model's Outcome must equal the TS Outcome exactly
 *          (same tag; same value, compared structurally with record keys order-independent; same message).
 *          A Lean `fault` (unparseable output, elaboration error, timeout) is a disagreement, never agreement.
 *
 * `tsVsTs(original, candidates, inputs, deps)`: the funnel stage for candidate rewrites: the original's outcomes are
 * computed once (instrumented when given a Translation, so inputs outside the model are excluded), then each candidate
 * runs on all inputs in one sandbox batch. A candidate fault is a disagreement; an original fault excludes the input.
 *
 * The engine does not depend on the prover package: Lean evaluation is injected as a `LeanEvaluator` (the prover's
 * `evalBatch` has this shape; tests and the CLI construct it from there).
 */
import { leanEvalExpr, leanPredicateExpr, parseLeanOutcome, type Outcome, type Translation, type Val } from '@faithful/translate';
import { Sandbox } from '../sandbox/sandbox.js';
import { compilePreconditions, generateInputs, type GenOptions, type GeneratedInputs } from './generate.js';
import { INSTRUMENTED_ENTRY, instrumentedSandboxSource } from './instrumented.js';

/** Structural shape of `@faithful/prover`'s `evalBatch` (only what the engine reads). */
export interface LeanEvalResult {
  /** Output per expression, aligned with the input; `null` when that `#eval` produced no output. */
  outputs: Array<string | null>;
  /** Errors keyed by expression index. */
  errors: Map<number, string>;
  check?: {
    ok: boolean;
    timedOut: boolean;
    diagnostics?: Array<{ severity: string; line: number; message: string }>;
  };
}

export interface LeanEvaluator {
  evalBatch(prelude: string, exprs: string[], opts: { budgetMs: number }): Promise<LeanEvalResult>;
}

/** Deep equality on `Val`s (record keys order-independent; numbers by value, -0 = 0). */
export function valEqual(a: Val, b: Val): boolean {
  if (a === b) return true;
  if (typeof a === 'number' && typeof b === 'number') return a === b;
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) {
    const bb = b as Val[];
    return a.length === bb.length && a.every((x, i) => valEqual(x, bb[i]!));
  }
  const ao = a as { [k: string]: Val };
  const bo = b as { [k: string]: Val };
  const ka = Object.keys(ao);
  const kb = Object.keys(bo);
  return ka.length === kb.length && ka.every((k) => Object.prototype.hasOwnProperty.call(bo, k) && valEqual(ao[k]!, bo[k]!));
}

/** Exact Outcome equality. `fault` is never equal to anything (a fault is never agreement). */
export function outcomeEqual(a: Outcome, b: Outcome): boolean {
  if (a.tag === 'fault' || b.tag === 'fault') return false;
  if (a.tag !== b.tag) return false;
  if (a.tag === 'ok') return valEqual(a.value, (b as { value: Val }).value);
  if (a.tag === 'throw') return a.message === (b as { message: string }).message;
  return a.detail === (b as { detail: string }).detail;
}

// ───────────────────────── tsVsLean ─────────────────────────

export interface TsVsLeanOptions {
  /** Inputs to generate under the `ts` preconditions. */
  n: number;
  seed: number;
  gen?: Omit<GenOptions, 'n' | 'seed'>;
  /** Sandbox budget per call, ms. Default 1000. */
  perCallMs?: number;
  /** Wall-clock budget of one Lean process (a chunk of up to 100 inputs), ms. Default 120000. */
  leanBudgetMs?: number;
  /**
   * Inputs whose instrumented TS call took longer than this (ms) are not sent to Lean (counted in `tooCostly`): the
   * Lean model is evaluated by `#eval`, which can be orders of magnitude slower than V8 on the same iteration count.
   * Default 20 (about 10^6 loop iterations of instrumented code; measured `#eval` cost of the same is ~1 s).
   */
  slowMs?: number;
  /** Inputs whose TS result serializes to more than this many characters are not sent to Lean (`tooCostly`). Default 100000. */
  maxResultChars?: number;
  /** Explicit inputs to use instead of generated ones (they still go through the `ts` preconditions). */
  inputs?: Val[][];
}

export interface TsVsLeanDeps {
  lean: LeanEvaluator;
  /** A sandbox to reuse; when absent one is opened and closed for this call. */
  sandbox?: Sandbox;
}

export type DisagreementKind = 'outcome' | 'range-ok' | 'instrumentation' | 'lean-error';

export interface Disagreement {
  kind: DisagreementKind;
  args: Val[];
  /** Instrumented original. */
  ts: Outcome;
  /** Plain original (for `instrumentation`). */
  plain?: Outcome;
  lean?: Outcome;
  predicates?: { rangeOk: string | null; asciiOk: string | null; pre: string | null };
  detail: string;
}

export interface TsVsLeanReport {
  fnName: string;
  seed: number;
  /** Candidates produced by the generator (including rejected and duplicate ones). */
  generated: number;
  rejectedByPrecondition: Record<string, number>;
  /** Distinct inputs satisfying every `ts` precondition. */
  underPreconditions: number;
  /** The generator could not reach `n` inputs within its attempt budget. */
  exhausted: boolean;
  /** Surrogate strings that a `bmp` precondition failed to reject (must be empty). */
  excludedAccepted: Val[][];
  /** Inputs where the instrumented original faulted (timeout etc.); not sent to Lean, never agreement. */
  tsFaults: number;
  tsFaultSamples: Array<{ args: Val[]; outcome: Outcome }>;
  /** Inputs inside the model but too slow or too large on the TS side to evaluate in Lean (see `slowMs`); never agreement. */
  tooCostly: number;
  tooCostlySamples: Array<{ args: Val[]; ms: number; chars: number }>;
  /** Inputs on which the instrumented original reported range-violation (outside `rangeOk` / `asciiOk`). */
  rangeExcluded: number;
  /** Range-excluded inputs where Lean's predicates agreed (pre = false, the right predicate false). */
  rangeOkAgreements: number;
  /** Inputs where TS returned or threw: the model was compared on these. */
  compared: number;
  /** Compared inputs with identical outcomes AND agreeing predicates (pre = true). */
  agreements: number;
  /** Outcome tags among agreements. */
  agreementTags: { ok: number; throw: number };
  disagreements: Disagreement[];
  tsMs: number;
  leanMs: number;
}

const PRED_TRUE = 'IO.println "true"';

function chunk<T>(xs: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += size) out.push(xs.slice(i, i + size));
  return out;
}

/** Differential test of the TypeScript original against the Lean model. See the module comment. */
export async function tsVsLean(t: Translation, opts: TsVsLeanOptions, deps: TsVsLeanDeps): Promise<TsVsLeanReport> {
  let gen: GeneratedInputs;
  if (opts.inputs) {
    // explicit inputs still go through the `ts` preconditions
    gen = { inputs: [], generated: 0, rejected: {}, duplicates: 0, excludedOffered: 0, excludedAccepted: [], exhausted: false };
    const preds = compilePreconditions(t.params, t.preconditions);
    for (const a of opts.inputs) {
      gen.generated++;
      const bad = preds.find((p) => !p.test(a));
      if (bad) gen.rejected[bad.id] = (gen.rejected[bad.id] ?? 0) + 1;
      else gen.inputs.push(a);
    }
  } else {
    gen = generateInputs(t, { ...opts.gen, n: opts.n, seed: opts.seed });
  }
  const inputs = gen.inputs;
  const report: TsVsLeanReport = {
    fnName: t.fnName,
    seed: opts.seed,
    generated: gen.generated,
    rejectedByPrecondition: gen.rejected,
    underPreconditions: inputs.length,
    exhausted: gen.exhausted,
    excludedAccepted: gen.excludedAccepted,
    tsFaults: 0,
    tsFaultSamples: [],
    tooCostly: 0,
    tooCostlySamples: [],
    rangeExcluded: 0,
    rangeOkAgreements: 0,
    compared: 0,
    agreements: 0,
    agreementTags: { ok: 0, throw: 0 },
    disagreements: [],
    tsMs: 0,
    leanMs: 0,
  };

  // 1. TypeScript side
  const own = deps.sandbox ? null : await Sandbox.open();
  const sb = deps.sandbox ?? own!;
  const perCallMs = opts.perCallMs ?? 1000;
  const idI = `tsVsLean:${t.lean.hash}:instrumented`;
  const idP = `tsVsLean:${t.lean.hash}:plain`;
  let inst: Outcome[];
  let instMs: number[];
  let plain: Outcome[];
  const t0 = performance.now();
  try {
    const li = await sb.load(idI, instrumentedSandboxSource(t), INSTRUMENTED_ENTRY, { instrumented: true });
    if (!li.ok) throw new Error(`differential: the instrumented original did not load in the sandbox: ${li.error}`);
    // `plainTs` carries the module constants the function reads; `source.text` alone is only the function statement
    // (red-team round 1, moduleConstBound / moduleConstHarness: every input was an `instrumentation` false alarm)
    const lp = await sb.load(idP, t.plainTs ?? t.source.text, t.fnName);
    if (!lp.ok) throw new Error(`differential: the original did not load in the sandbox: ${lp.error}`);
    const ri = (await sb.callBatch(idI, inputs, { perCallMs })).results;
    inst = ri.map((r) => r.outcome);
    instMs = ri.map((r) => r.ms);
    // the plain original only where the instrumented one returned or threw: on a range violation the plain original
    // keeps going (e.g. a loop to 2^53) and would only cost a timeout and a worker respawn
    const live = inputs.map((_, k) => k).filter((k) => inst[k]!.tag === 'ok' || inst[k]!.tag === 'throw');
    const rp = (await sb.callBatch(idP, live.map((k) => inputs[k]!), { perCallMs })).results;
    plain = inputs.map(() => ({ tag: 'fault', detail: 'not run' }) as Outcome);
    live.forEach((k, j) => (plain[k] = rp[j]!.outcome));
    await sb.unload(idI);
    await sb.unload(idP);
  } finally {
    if (own) await own.close();
  }
  report.tsMs = performance.now() - t0;

  // 2. select what goes to Lean
  const hasAscii = t.preconditions.some((p) => p.kind === 'ascii');
  interface Job {
    k: number;
    model: boolean;
  }
  const jobs: Job[] = [];
  inputs.forEach((args, k) => {
    const o = inst[k]!;
    if (o.tag === 'fault') {
      report.tsFaults++;
      if (report.tsFaultSamples.length < 5) report.tsFaultSamples.push({ args, outcome: o });
      return;
    }
    {
      const chars = o.tag === 'ok' ? JSON.stringify(o.value).length : 0;
      if (instMs[k]! > (opts.slowMs ?? 20) || chars > (opts.maxResultChars ?? 100_000)) {
        report.tooCostly++;
        if (report.tooCostlySamples.length < 5) report.tooCostlySamples.push({ args: chars > 2000 ? [] : args, ms: instMs[k]!, chars });
        return;
      }
    }
    if (o.tag !== 'range-violation') {
      const p = plain[k]!;
      if (!outcomeEqual(o, p)) {
        report.disagreements.push({ kind: 'instrumentation', args, ts: o, plain: p, detail: 'instrumented and plain original differ on an input inside the model' });
      }
    }
    jobs.push({ k, model: o.tag === 'ok' || o.tag === 'throw' });
  });

  // 3. Lean side: one #eval per input printing 3 or 4 lines (predicates first, then the model when wanted).
  const exprOf = (j: Job): string => {
    const args = inputs[j.k]!;
    const parts = [
      leanPredicateExpr(t, 'rangeOk', args),
      hasAscii ? leanPredicateExpr(t, 'asciiOk', args) : PRED_TRUE,
      leanPredicateExpr(t, 'pre', args),
    ];
    if (j.model) parts.push(leanEvalExpr(t, args));
    return `(do ${parts.join('; ')})`;
  };
  const t1 = performance.now();
  const budget = opts.leanBudgetMs ?? 120_000;
  // Chunks bound the damage of a Lean timeout without paying start-up per input; a chunk that times out is retried
  // one input per process, so only the inputs that are themselves too slow are lost (as `lean-error`).
  const runChunk = async (part: Job[]): Promise<void> => {
    const res = await deps.lean.evalBatch(t.lean.source, part.map(exprOf), { budgetMs: budget });
    if (res.check?.timedOut && part.length > 1) {
      for (const j of part) await runChunk([j]);
      return;
    }
    part.forEach((j, idx) => {
      const args = inputs[j.k]!;
      const ts = inst[j.k]!;
      const err = res.errors.get(idx);
      const raw = res.outputs[idx];
      const lines = raw === null || raw === undefined ? [] : raw.split('\n');
      const want = j.model ? 4 : 3;
      if (err !== undefined || lines.length !== want) {
        const why = err ?? (res.check?.timedOut ? 'Lean timed out' : `expected ${want} output lines, got ${lines.length}: ${JSON.stringify(raw)}`);
        report.disagreements.push({ kind: 'lean-error', args, ts, detail: why });
        return;
      }
      const predicates = { rangeOk: lines[0]!, asciiOk: lines[1]!, pre: lines[2]! };
      // range-ok agreement
      let expected: { rangeOk: string; asciiOk: string; pre: string };
      if (ts.tag === 'range-violation') {
        expected = ts.detail.startsWith('ascii')
          ? { rangeOk: 'true', asciiOk: 'false', pre: 'false' }
          : { rangeOk: 'false', asciiOk: 'true', pre: 'false' };
      } else expected = { rangeOk: 'true', asciiOk: 'true', pre: 'true' };
      const predOk = predicates.rangeOk === expected.rangeOk && predicates.asciiOk === expected.asciiOk && predicates.pre === expected.pre;
      if (!predOk) {
        report.disagreements.push({
          kind: 'range-ok',
          args,
          ts,
          predicates,
          detail: `Lean predicates ${JSON.stringify(predicates)}, expected ${JSON.stringify(expected)} from the instrumented original`,
        });
      }
      if (ts.tag === 'range-violation') {
        report.rangeExcluded++;
        if (predOk) report.rangeOkAgreements++;
        return;
      }
      report.compared++;
      const lean = parseLeanOutcome(lines[3]);
      if (!outcomeEqual(ts, lean)) {
        report.disagreements.push({ kind: 'outcome', args, ts, lean, predicates, detail: 'Lean model and TypeScript original differ' });
        return;
      }
      if (predOk) {
        report.agreements++;
        if (ts.tag === 'ok') report.agreementTags.ok++;
        else report.agreementTags.throw++;
      }
    });
  };
  for (const part of chunk(jobs, 100)) await runChunk(part);
  report.leanMs = performance.now() - t1;
  return report;
}

// ───────────────────────── tsVsTs ─────────────────────────

let loadSeq = 0;

export interface TsProgram {
  source: string;
  fnName: string;
}

export interface TsVsTsDeps {
  sandbox?: Sandbox;
}

export interface TsVsTsCandidateReport {
  index: number;
  fnName: string;
  /** The candidate did not load (syntax, impure top level, ...): every input counts as a disagreement. */
  loadError: string | null;
  compared: number;
  agreements: number;
  disagreements: Array<{ args: Val[]; original: Outcome; candidate: Outcome }>;
  /** Inputs that mutated an argument in the candidate (reported; the outcome is still compared). */
  mutatedInputs: number;
}

export interface TsVsTsReport {
  inputs: number;
  /** Inputs where the original was outside the model (range-violation; only with a Translation as original). */
  rangeExcluded: number;
  /** Inputs where the original faulted: excluded, they decide nothing. */
  originalFaults: number;
  candidates: TsVsTsCandidateReport[];
  ms: number;
}

/**
 * Compare one or more candidate implementations against the original on the same inputs. The original runs once
 * (instrumented when it is a Translation); each candidate runs all inputs in one sandbox batch.
 */
export async function tsVsTs(
  original: Translation | TsProgram,
  candidates: TsProgram | TsProgram[],
  inputs: Val[][],
  deps: TsVsTsDeps & { perCallMs?: number } = {},
): Promise<TsVsTsReport> {
  const list = Array.isArray(candidates) ? candidates : [candidates];
  const own = deps.sandbox ? null : await Sandbox.open();
  const sb = deps.sandbox ?? own!;
  const perCallMs = deps.perCallMs ?? 1000;
  const t0 = performance.now();
  try {
    const isTr = (o: Translation | TsProgram): o is Translation => (o as Translation).instrumentedTs !== undefined;
    const idO = `tsVsTs:original:${++loadSeq}`;
    const lo = isTr(original)
      ? await sb.load(idO, instrumentedSandboxSource(original), INSTRUMENTED_ENTRY, { instrumented: true })
      : await sb.load(idO, original.source, original.fnName);
    if (!lo.ok) throw new Error(`tsVsTs: the original did not load: ${lo.error}`);
    const orig = (await sb.callBatch(idO, inputs, { perCallMs })).results.map((r) => r.outcome);
    await sb.unload(idO);
    const live: number[] = [];
    let rangeExcluded = 0;
    let originalFaults = 0;
    orig.forEach((o, k) => {
      if (o.tag === 'range-violation') rangeExcluded++;
      else if (o.tag === 'fault') originalFaults++;
      else live.push(k);
    });
    const liveInputs = live.map((k) => inputs[k]!);
    const reports: TsVsTsCandidateReport[] = [];
    for (let ci = 0; ci < list.length; ci++) {
      const c = list[ci]!;
      const rep: TsVsTsCandidateReport = { index: ci, fnName: c.fnName, loadError: null, compared: live.length, agreements: 0, disagreements: [], mutatedInputs: 0 };
      const idC = `tsVsTs:candidate:${ci}:${++loadSeq}`;
      const lc = await sb.load(idC, c.source, c.fnName);
      if (!lc.ok) {
        rep.loadError = lc.error;
        for (const k of live) rep.disagreements.push({ args: inputs[k]!, original: orig[k]!, candidate: { tag: 'fault', detail: `did not load: ${lc.error}` } });
        reports.push(rep);
        continue;
      }
      const res = await sb.callBatch(idC, liveInputs, { perCallMs });
      await sb.unload(idC);
      res.results.forEach((r, j) => {
        const k = live[j]!;
        if (r.violations.some((v) => v.kind === 'input-mutation')) rep.mutatedInputs++;
        if (outcomeEqual(orig[k]!, r.outcome)) rep.agreements++;
        else rep.disagreements.push({ args: inputs[k]!, original: orig[k]!, candidate: r.outcome });
      });
      reports.push(rep);
    }
    return { inputs: inputs.length, rangeExcluded, originalFaults, candidates: reports, ms: performance.now() - t0 };
  } finally {
    if (own) await own.close();
  }
}
