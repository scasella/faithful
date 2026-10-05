/**
 * The bounded equivalence query and the adaptive "Verified to k" driver.
 *
 * checkEquivalent(original, candidate, bounds, budgetMs, z3): both IRs are encoded over the SAME symbolic inputs
 * (inputs.ts: arrays of at most `array` elements, strings of at most `string` BMP units, integers in [-int, int]).
 * Asserted: the original's run stays inside the model (no range/bounds/nonzero/length/ascii/depth violation) and
 * neither run reaches the unrolling bound U. Asked: do the outcomes differ (status — a different thrown message, a
 * throw against a return, or the candidate leaving the model where the original does not — or both return and the
 * values differ)?
 *   unsat         no distinguishing input exists within the bounds under this encoding, AND the coverage check passed:
 *                 the checked set is non-empty (otherwise `unknown`, "vacuous") and no input inside the bounds whose
 *                 integers are all in [-1, 1] needs more than U iterations (otherwise `unknown`, "size-driven"). When
 *                 other inputs inside the bounds need more than U iterations, the result's `bounds.int` is NARROWED to
 *                 an integer bound B' inside which Z3 checked that no input was excluded (`coverage.kind =
 *                 'int-driven'`, `intBound`, an excluded `example`); the claim is then exact for the bounds it states
 *                 (red-team round 2, R2-V4: an "all integers 0" classification is not sound).
 *   sat           Z3's input is decoded and REPLAYED on both instrumented functions in the sandbox; the result is `sat`
 *                 only when the replayed outcomes differ (both non-fault, original not a range violation). Otherwise
 *                 `inconclusive` (encoder disagrees with execution): never a rejection.
 *   unknown / timeout / unsupported as named.
 */
import type { Z3Info } from '@faithful/core';
import { outcomeEqual, type Sandbox } from '@faithful/engine';
import type { SmtDetail } from '@faithful/session';
import { tyKey, type IrProgram, type Outcome, type Translation, type Ty, type Val } from '@faithful/translate';
import { Encoder, ST_FUEL, VIOL_BASE, unsupportedConstructs, type R, type Shared } from './encode.js';
import { declareInput, type Bounds } from './inputs.js';
import { decodeOutcome, lookup, outcomeTerms, type EncodedOutcome } from './outcome.js';
import { runInstrumented } from './replay.js';
import { readAnswers, transcript } from './sexpr.js';
import { Smt, TooLarge, Unsupported, and, eq, ge, implies, int, le, lt, ne, not, or, type T } from './terms.js';
import { asInt, asSeq, decode, leaves, svEq, type ModelValue, type SV } from './values.js';
import type { Z3Driver } from './z3.js';

export interface FnUnderTest {
  translation: Translation;
  ir: IrProgram;
}

export interface EquivBounds extends Bounds {
  /** Unrolling bound U. */
  unroll: number;
}

export type EquivStatus = 'unsat' | 'sat' | 'unknown' | 'timeout' | 'unsupported' | 'inconclusive';

export interface Counterexample {
  input: Val[];
  /** Replayed in the sandbox (instrumented original). */
  original: Outcome;
  /** Replayed in the sandbox (instrumented candidate). */
  candidate: Outcome;
  /** What the encoding predicted (for diagnosis; the replayed outcomes are the evidence). */
  predicted: { original: EncodedOutcome; candidate: EncodedOutcome };
}

export interface EquivResult {
  status: EquivStatus;
  /** The sequence bound this result is about: min(array, string). */
  k: number;
  bounds: Bounds;
  unroll: number;
  ms: number;
  /** Time inside Z3. */
  solveMs: number;
  z3: Z3Info;
  counterexample?: Counterexample;
  /** For `unsupported`: the constructs. */
  unsupported?: string[];
  /** Plain words for unknown / timeout / unsupported / inconclusive. */
  reason?: string;
  /** What `unsat` means under this encoding (bounds and U spelled out, plus what the coverage check found). */
  encodingNote: string;
  smtChars?: number;
  /**
   * Which inputs inside the requested bounds the query actually covered (set whenever the main query answered `unsat`):
   *   full        no input inside the bounds was excluded by the unrolling bound U (Z3 checked; trivially when no
   *               loop or recursion reached U)
   *   int-driven  some inputs inside the requested bounds need more than U iterations (`example` is one), none with
   *               every integer in [-1, 1]. The status is `unsat` with `bounds.int` narrowed to `intBound`, an integer
   *               bound inside which Z3 checked that no input was excluded (`requestedInt` is the bound asked for).
   *   unknown     as int-driven, but Z3 could not decide whether inputs beyond `intBound` were excluded (no example);
   *               `bounds.int` is narrowed to `intBound` likewise
   *   size-driven an input inside the bounds whose integers are all in [-1, 1] needs more than U iterations
   *               (`example`): the sequence bounds are not covered, the status is `unknown`
   *   vacuous     no input inside the bounds (or inside the narrowed bounds) is checked at all (the original leaves
   *               the model or some run reaches U on every input; `fuel` says whether U was involved): `unknown`
   */
  coverage?: Coverage;
}

export interface Coverage {
  kind: 'full' | 'int-driven' | 'unknown' | 'size-driven' | 'vacuous';
  /** An input inside the bounds that the query excluded because of U (decoded from Z3's model). */
  example?: Val[];
  /** For `vacuous`: whether some run reached U (otherwise the original leaves the model on every input). */
  fuel?: boolean;
  /** For `int-driven` / `unknown`: the narrowed integer bound B' (the result's `bounds.int`). */
  intBound?: number;
  /** For `int-driven` / `unknown`: the integer bound that was requested. */
  requestedInt?: number;
}

/** An input as JSON with every code unit outside printable ASCII written as \\uXXXX (readable in any terminal). */
function showInput(v: Val[]): string {
  return JSON.stringify(v).replace(/[^\x20-\x7e]/g, (ch) => `\\u${ch.charCodeAt(0).toString(16).padStart(4, '0')}`);
}

/** The sentence `encodingNote` gains from the coverage check. */
function coverageNote(c: Coverage, unroll: number): string {
  switch (c.kind) {
    case 'full':
      return ` Coverage: no input inside these bounds needs more than ${unroll} iterations (checked), so no input inside the bounds was excluded by the unrolling bound.`;
    case 'int-driven':
    case 'unknown': {
      const B = c.requestedInt ?? '?';
      const Bn = c.intBound ?? 0;
      const why =
        c.kind === 'int-driven'
          ? `SOME INPUTS INSIDE THESE BOUNDS WERE EXCLUDED because a loop or recursion needs more than ${unroll} iterations on them` +
            `${c.example ? ` (for example ${showInput(c.example)})` : ''}`
          : `Z3 could not decide whether inputs inside these bounds need more than ${unroll} iterations`;
      return (
        ` Coverage: the requested bounds had every number an integer in [-${B}, ${B}]; ${why}. The claim above is therefore ` +
        `NARROWED to integers in [-${Bn}, ${Bn}]: Z3 checked that no input inside the narrowed bounds needs more than ` +
        `${unroll} iterations. (Inputs with larger integers that finish within ${unroll} iterations were checked too and ` +
        `showed no difference; nothing is claimed for the excluded ones.)`
      );
    }
    default:
      return '';
  }
}

export function encodingNote(b: Bounds, unroll: number): string {
  return (
    `Bounded SMT check (Z3) of the translator's IR. "unsat" means: Z3 found no input with every array of at most ${b.array} ` +
    `elements, every string of at most ${b.string} UTF-16 units of BMP text, and every number an integer in [-${b.int}, ${b.int}], ` +
    `on which the original stays inside the model (range-ok, and ascii where it applies) and both functions finish within ` +
    `${unroll} iterations of each loop entry and ${unroll} nested calls of a recursive function, where the two outcomes differ ` +
    `(return value, thrown message, or the candidate leaving the model). Integers are exact (JavaScript % as truncated ` +
    `remainder, Math.floor/Math.ceil division written out), strings and arrays are bounded sequences, sort is a stable ` +
    `sorting network. It says nothing about larger inputs, wider integers, or inputs that need more iterations.`
  );
}

function sigMismatch(a: FnUnderTest, b: FnUnderTest): string | null {
  const pa = a.translation.params.map((p) => tyKey(p.ty));
  const pb = b.translation.params.map((p) => tyKey(p.ty));
  if (pa.join(',') !== pb.join(',')) return `parameter types differ: (${pa.join(', ')}) vs (${pb.join(', ')})`;
  if (tyKey(a.translation.ret) !== tyKey(b.translation.ret)) return `return types differ: ${tyKey(a.translation.ret)} vs ${tyKey(b.translation.ret)}`;
  return null;
}

/** One bounded equivalence query. `budgetMs` covers encoding, solving and replay. */
export async function checkEquivalent(
  original: FnUnderTest,
  candidate: FnUnderTest,
  bounds: EquivBounds,
  budgetMs: number,
  z3: Z3Driver,
  deps: { sandbox?: Sandbox; maxChars?: number } = {},
): Promise<EquivResult> {
  const t0 = performance.now();
  const b: Bounds = { array: bounds.array, string: bounds.string, int: bounds.int };
  const base = {
    k: Math.min(bounds.array, bounds.string),
    bounds: b,
    unroll: bounds.unroll,
    z3: z3.info(),
    encodingNote: encodingNote(b, bounds.unroll),
    solveMs: 0,
  };
  const done = (r: Omit<EquivResult, 'ms' | keyof typeof base> & Partial<EquivResult>): EquivResult => ({ ...base, ...r, ms: performance.now() - t0 });

  const mism = sigMismatch(original, candidate);
  if (mism) return done({ status: 'unsupported', unsupported: [mism], reason: `unsupported: ${mism}` });
  const bad = [...unsupportedConstructs(original.ir).map((c) => `original: ${c}`), ...unsupportedConstructs(candidate.ir).map((c) => `candidate: ${c}`)];
  if (bad.length) return done({ status: 'unsupported', unsupported: bad, reason: bad.map((c) => `unsupported: ${c}`).join('; ') });

  // encoding
  const smt = new Smt({ maxChars: deps.maxChars ?? 40_000_000 });
  smt.emit('(set-option :produce-models true)');
  const shared: Shared = { msgs: [] };
  const params = original.translation.params.map((p) => p.ty);
  const ins = params.map((ty, i) => declareInput(smt, ty, b, `in${i}`));
  let ro: R;
  let rc: R;
  let eo: Encoder;
  let ec: Encoder;
  try {
    for (const x of ins) smt.assert(x.dom);
    eo = new Encoder(smt, original.ir, { unroll: bounds.unroll, shared });
    ec = new Encoder(smt, candidate.ir, { unroll: bounds.unroll, shared });
    ro = eo.run(ins.map((x) => x.v));
    rc = ec.run(ins.map((x) => x.v));
  } catch (e) {
    if (e instanceof Unsupported) return done({ status: 'unsupported', unsupported: [e.construct], reason: e.message });
    if (e instanceof TooLarge) return done({ status: 'unknown', reason: `${e.message} (bounds did not complete)`, smtChars: smt.size });
    // The encoder inlines one JavaScript stack frame chain per unrolled activation; a deep U can exhaust the stack.
    if (e instanceof RangeError && /call stack/i.test(e.message)) {
      return done({ status: 'unknown', reason: `the encoder ran out of JavaScript stack at U = ${bounds.unroll} (unrolling too deep; bounds did not complete)`, smtChars: smt.size });
    }
    throw e;
  }
  // The checked set: the original stays inside the model and finishes, the candidate finishes.
  const pre = and(or(eq(ro.st, '0'), and(ge(ro.st, '2'), lt(ro.st, String(VIOL_BASE)))), ne(rc.st, ST_FUEL));
  // The outcomes differ.
  const differ = or(ne(ro.st, rc.st), and(eq(ro.st, '0'), not(svEq(ro.v, rc.v))));
  const fuelUsed = eo.fuelUsed || ec.fuelUsed;
  const baseText = smt.text();
  const inTerms: T[] = ins.flatMap((x) => leaves(x.v));
  const oTerms = outcomeTerms(ro);
  const cTerms = outcomeTerms(rc);
  const terms = [...inTerms, ...oTerms, ...cTerms];
  // One solver call, two questions (sections separated by `(reset)`, as sanity mode does):
  //   1. is there an input in the checked set on which the outcomes differ (the query)?
  //   2. is the checked set non-empty at all? An `unsat` over an empty set verifies nothing (finding V1).
  const script =
    `${baseText}\n(assert ${pre})\n(assert ${differ})\n(check-sat)\n(get-value (${terms.join(' ')}))\n` +
    `(reset)\n${baseText}\n(assert ${pre})\n(check-sat)\n`;
  const remaining = budgetMs - (performance.now() - t0);
  if (remaining <= 50) return done({ status: 'timeout', reason: 'the budget ran out while encoding', smtChars: smt.size });
  const r = await z3.solve(script, { timeoutMs: remaining });
  base.solveMs = r.ms;
  if (r.status === 'timeout') return done({ status: 'timeout', reason: `Z3 did not answer within the budget (${Math.round(budgetMs)} ms)`, smtChars: smt.size });
  if (r.status === 'error') return done({ status: 'unknown', reason: `solver error: ${r.output.slice(0, 500)}`, smtChars: smt.size });
  const { answers, errors } = readAnswers(transcript(r));
  if (errors.length) return done({ status: 'unknown', reason: `solver error: ${errors.join(' | ').slice(0, 500)}`, smtChars: smt.size });
  const a = answers[0];
  if (!a || a.status === 'unknown') return done({ status: 'unknown', reason: `Z3 answered unknown${r.output ? `: ${r.output.slice(0, 200)}` : ''}`, smtChars: smt.size });
  if (a.status === 'unsat') {
    // Before `unsat` is reported: what did the query cover?
    const nonEmpty = answers[1];
    if (!nonEmpty || nonEmpty.status === 'unknown') {
      return done({ status: 'unknown', reason: 'no distinguishing input was found, but Z3 could not decide whether any input inside the bounds was checked at all; nothing is claimed', smtChars: smt.size });
    }
    if (nonEmpty.status === 'unsat') {
      const why = fuelUsed
        ? `on every input inside the bounds the original leaves the model or a run needs more than U = ${bounds.unroll} iterations`
        : 'the original leaves the model (a range/bounds/nonzero/length/ascii/depth check fails) on every input inside the bounds';
      return done({
        status: 'unknown',
        coverage: { kind: 'vacuous', fuel: fuelUsed },
        reason: `vacuous: ${why}, so no input was checked and nothing is claimed`,
        smtChars: smt.size,
      });
    }
    if (!fuelUsed) {
      const coverage: Coverage = { kind: 'full' };
      return done({ status: 'unsat', coverage, encodingNote: base.encodingNote + coverageNote(coverage, bounds.unroll), smtChars: smt.size });
    }
    return coverageCheck();
  }
  if (!a.values) return done({ status: 'unknown', reason: 'Z3 answered sat without a model', smtChars: smt.size });
  return replaySat(a.values);

  /**
   * The query is `unsat` over a non-empty checked set, and some activation reached U. Which inputs inside the bounds
   * were excluded by U? Excluded = the original reaches U, or the candidate reaches U while the original is inside
   * the model (inputs where the original leaves the model are excluded by design).
   *
   * Red-team round 2 (R2-V4, r2MergeCapIntGatedDiffer): no pinned integer value can tell what DRIVES an exclusion (an
   * early return at n = 0, a throw, `12 % n`, or a merge that is short when every element is 0 all hide a
   * length-driven loop from an "all integers 0" probe). So the coverage check no longer classifies; it makes the
   * reported bounds exact. `box(m)` = every integer leaf (parameters and integer elements/fields below the length;
   * not string code units, not booleans, not lengths) is in [-m, m].
   *   call 2: (a) excluded ∧ box(0), (b) excluded ∧ box(1), (c) excluded, (d) checked set ∧ box(1).
   *     (a) or (b) sat: inputs inside the bounds whose integers are all in [-1, 1] need more than U iterations: the
   *         stated bounds are not covered, `unknown` ("size-driven"; verifiedToK raises U). This cutoff is POLICY,
   *         not the soundness argument: a pair that guards |n| <= 1 passes it and gets a true but weak claim at ±1.
   *     (c) unsat: no input inside the bounds was excluded: `unsat` at the requested bounds (`full`).
   *     otherwise: further calls certify an m with excluded ∧ box(m) unsat: first M - 1 (M = the largest |integer| of
   *         (c)'s example, or B when (c) is unknown), else the largest power of two below it whose rung and every
   *         smaller rung is unsat (1 when none is). The result is `unsat` with `bounds.int` NARROWED to that m (B'): inside the narrowed bounds no input
   *         was excluded (checked), so the claim is exact. (d), or call 4 (checked set ∧ box(B')) when (d) is not
   *         sat, makes sure the narrowed set is not empty (V1 inside the box).
   * Any unknown or timeout before a box is certified is `unknown`/`timeout`, never `unsat`.
   */
  async function coverageCheck(): Promise<EquivResult> {
    const inModel = or(eq(ro.st, '0'), and(ge(ro.st, '2'), lt(ro.st, String(VIOL_BASE))));
    const excluded = or(eq(ro.st, ST_FUEL), and(eq(rc.st, ST_FUEL), inModel));
    const box = (m: number): T => and(...ins.flatMap((x, i) => intBox(x.v, params[i]!, m)));
    const getIns = inTerms.length ? `(get-value (${inTerms.join(' ')}))\n` : '';
    const section = (asserts: T[], withValues: boolean): string =>
      `${baseText}\n${asserts.map((t) => `(assert ${t})\n`).join('')}(check-sat)\n${withValues ? getIns : ''}`;
    const noClaim = 'no distinguishing input was found among the inputs that finish within U, but';
    const solve = async (script: string, what: string): Promise<{ answers: ReturnType<typeof readAnswers>['answers'] } | EquivResult> => {
      const left = budgetMs - (performance.now() - t0);
      if (left <= 50) return done({ status: 'timeout', reason: `${noClaim} the budget ran out before ${what}`, smtChars: smt.size });
      const rr = await z3.solve(script, { timeoutMs: left });
      base.solveMs += rr.ms;
      if (rr.status === 'timeout') return done({ status: 'timeout', reason: `${noClaim} ${what} did not answer within the budget`, smtChars: smt.size });
      if (rr.status === 'error') return done({ status: 'unknown', reason: `${noClaim} ${what} failed: ${rr.output.slice(0, 500)}`, smtChars: smt.size });
      const rd = readAnswers(transcript(rr));
      if (rd.errors.length) return done({ status: 'unknown', reason: `${noClaim} ${what} failed: ${rd.errors.join(' | ').slice(0, 500)}`, smtChars: smt.size });
      return { answers: rd.answers };
    };
    const example = (ans: { values?: ModelValue[] }): Val[] | undefined => {
      if (!inTerms.length) return [];
      if (!ans.values) return undefined;
      const g = lookup(inTerms, ans.values);
      return ins.map((x, i) => decode(x.v, params[i]!, g));
    };

    const s2 = await solve(
      [section([excluded, box(0)], true), section([excluded, box(1)], true), section([excluded], true), section([pre, box(1)], false)].join('(reset)\n'),
      'the coverage check',
    );
    if (!('answers' in s2)) return s2;
    const [z0, z1, any, nonEmpty1] = s2.answers;
    for (const [z, range] of [
      [z0, 'with every integer 0'],
      [z1, 'with every integer in [-1, 1]'],
    ] as const) {
      if (!z || z.status === 'unknown') {
        return done({ status: 'unknown', reason: `${noClaim} Z3 could not decide whether inputs inside the bounds ${range} need more than U = ${bounds.unroll} iterations; nothing is claimed`, smtChars: smt.size });
      }
      if (z.status === 'sat') {
        const ex = example(z);
        return done({
          status: 'unknown',
          coverage: { kind: 'size-driven', ...(ex ? { example: ex } : {}) },
          reason:
            `${noClaim} inputs inside the bounds need more than U = ${bounds.unroll} iterations even ${range}` +
            `${ex ? ` (for example ${showInput(ex)})` : ''}, so the stated bounds are not covered and nothing is claimed at them`,
          smtChars: smt.size,
        });
      }
    }
    if (any && any.status === 'unsat') {
      const coverage: Coverage = { kind: 'full' };
      return done({ status: 'unsat', coverage, encodingNote: base.encodingNote + coverageNote(coverage, bounds.unroll), smtChars: smt.size });
    }

    // Some input inside the bounds was excluded (or Z3 could not say), and none with every integer in [-1, 1]: narrow
    // the integer bound to a box Z3 certifies has no excluded input.
    const ex = any && any.status === 'sat' ? example(any) : undefined;
    let top = b.int;
    if (ex) {
      const m = maxAbsInt(ex);
      if (m <= 1) {
        return done({ status: 'unknown', reason: `${noClaim} the coverage check's answers are inconsistent (an excluded input with every integer in [-1, 1]: ${showInput(ex)}); nothing is claimed`, smtChars: smt.size });
      }
      top = Math.min(top, m);
    }
    let certified = Math.min(1, b.int);
    const tryRungs = async (rungs: number[]): Promise<boolean | EquivResult> => {
      // true when every rung is `unsat` (certified = the last); false at the first rung that is not
      const s3 = await solve(rungs.map((m) => section([excluded, box(m)], false)).join('(reset)\n'), 'narrowing the integer bound');
      if (!('answers' in s3)) return s3;
      for (let i = 0; i < rungs.length; i++) {
        if (s3.answers[i]?.status !== 'unsat') return false;
        certified = rungs[i]!;
      }
      return true;
    };
    // First the rung just below the excluded example (Z3's example is often the smallest excluded magnitude, and
    // then one section decides). Otherwise powers of two below it, smallest first, LADDER_BATCH per solver call; the
    // first rung that is not `unsat` ends the search. Every certified rung has all smaller boxes inside it, so the
    // certified bound is sound whether or not it is the largest.
    let found = false;
    if (top - 1 >= 2) {
      const r = await tryRungs([top - 1]);
      if (typeof r !== 'boolean') return r;
      found = r;
    }
    if (!found) {
      certified = Math.min(1, b.int);
      const ladder: number[] = [];
      for (let m = 2; m < top - 1; m *= 2) ladder.push(m);
      for (let at = 0; at < ladder.length; at += LADDER_BATCH) {
        const r = await tryRungs(ladder.slice(at, at + LADDER_BATCH));
        if (typeof r !== 'boolean') return r;
        if (!r) break;
      }
    }
    // the narrowed checked set must not be empty
    if (!(nonEmpty1 && nonEmpty1.status === 'sat')) {
      const s4 = await solve(section([pre, box(certified)], false), 'the non-emptiness check of the narrowed bounds');
      if (!('answers' in s4)) return s4;
      const ne4 = s4.answers[0];
      if (!ne4 || ne4.status !== 'sat') {
        return done({
          status: 'unknown',
          coverage: { kind: 'vacuous', fuel: true },
          reason: `vacuous: inputs inside the bounds need more than U = ${bounds.unroll} iterations, and inside the integer range where none does ([-${certified}, ${certified}]) Z3 ${ne4?.status === 'unsat' ? 'found no input on which the original stays inside the model and both runs finish' : 'could not decide whether any input is checked'}; nothing is claimed`,
          smtChars: smt.size,
        });
      }
    }
    const narrowed: Bounds = { ...b, int: certified };
    const coverage: Coverage = { kind: ex ? 'int-driven' : 'unknown', intBound: certified, requestedInt: b.int, ...(ex ? { example: ex } : {}) };
    return done({
      status: 'unsat',
      bounds: narrowed,
      coverage,
      encodingNote: encodingNote(narrowed, bounds.unroll) + coverageNote(coverage, bounds.unroll),
      smtChars: smt.size,
    });
  }

  /** sat: decode Z3's input and replay it on both instrumented functions in the sandbox. */
  async function replaySat(values: ModelValue[]): Promise<EquivResult> {
    const get = lookup(terms, values);
    const input = ins.map((x, i) => decode(x.v, params[i]!, get));
    const predicted = {
      original: decodeOutcome(ro, original.translation.ret, eo, shared, get),
      candidate: decodeOutcome(rc, candidate.translation.ret, ec, shared, get),
    };
    const replayed = await runInstrumented([original.translation, candidate.translation], [input], { sandbox: deps.sandbox });
    const o = replayed[0]![0]!;
    const c = replayed[1]![0]!;
    const cex: Counterexample = { input, original: o, candidate: c, predicted };
    if (o.tag === 'fault' || c.tag === 'fault') {
      return done({ status: 'inconclusive', counterexample: cex, reason: 'inconclusive (encoder disagrees with execution): the replay faulted, so the difference is not confirmed', smtChars: smt.size });
    }
    if (o.tag === 'range-violation') {
      return done({ status: 'inconclusive', counterexample: cex, reason: 'inconclusive (encoder disagrees with execution): the encoding placed this input inside the model, the instrumented original reports a range violation', smtChars: smt.size });
    }
    if (outcomeEqual(o, c)) {
      return done({ status: 'inconclusive', counterexample: cex, reason: 'inconclusive (encoder disagrees with execution): Z3 found a difference, the replayed functions agree on its input', smtChars: smt.size });
    }
    return done({ status: 'sat', counterexample: cex, smtChars: smt.size });
  }
}

/** Rungs of the integer-narrowing ladder per solver call (coverageCheck). */
const LADDER_BATCH = 3;

/**
 * `box(m)` for one input of type `ty`: every integer leaf (parameters and integer elements/fields; not string code
 * units, not lengths, not booleans) is in [-m, m]. Array elements count only below the length (padding slots are
 * never read, and pinning them would not change the set of inputs).
 */
function intBox(v: SV, ty: Ty, m: number, out: T[] = []): T[] {
  switch (ty.k) {
    case 'int': {
      const x = asInt(v);
      out.push(m === 0 ? eq(x, '0') : and(le(int(-m), x), le(x, int(m))));
      break;
    }
    case 'array': {
      const s = asSeq(v);
      s.el.forEach((e, j) => {
        const inner = intBox(e, ty.elem, m);
        if (inner.length) out.push(implies(lt(String(j), s.len), and(...inner)));
      });
      break;
    }
    case 'tuple':
      if (v.k === 'tup') ty.elems.forEach((e, i) => intBox(v.el[i]!, e, m, out));
      break;
    case 'record':
      if (v.k === 'rec') for (const f of ty.fields) intBox(v.f[f.name]!, f.ty, m, out);
      break;
    default:
      break;
  }
  return out;
}

/** The largest |integer| in a decoded input (numbers are the integer leaves; strings and booleans are skipped). */
function maxAbsInt(v: Val | Val[]): number {
  if (typeof v === 'number') return Math.abs(v);
  if (Array.isArray(v)) return v.reduce<number>((m, x) => Math.max(m, maxAbsInt(x)), 0);
  if (v && typeof v === 'object') return Object.values(v).reduce<number>((m, x) => Math.max(m, maxAbsInt(x)), 0);
  return 0;
}

export interface AdaptiveOptions {
  /** Total wall-clock budget, ms. */
  budgetMs: number;
  z3: Z3Driver;
  /** Bounds tried in order; the defaults end at arrays 6, strings 8, integers ±2^16. */
  steps?: EquivBounds[];
  sandbox?: Sandbox;
  maxChars?: number;
}

export const DEFAULT_STEPS: EquivBounds[] = [
  { array: 2, string: 2, int: 2 ** 4, unroll: 4 },
  { array: 4, string: 4, int: 2 ** 8, unroll: 6 },
  { array: 6, string: 6, int: 2 ** 12, unroll: 8 },
  { array: 6, string: 8, int: 2 ** 16, unroll: 10 },
];

/**
 * The largest unrolling bound `verifiedToK` raises U to when inputs inside a step's bounds need more iterations
 * (U doubles: 4 -> 8 -> 16 -> 32 -> 64, 10 -> 20 -> 40).
 */
export const MAX_UNROLL = 64;

export interface VerifiedToK {
  /** The result at the largest completed step (or the step that ended the run: sat, inconclusive, unsupported). */
  result: EquivResult;
  /** Every step attempted, in order. */
  attempts: EquivResult[];
  /** The session's stage detail; null when the status has no SmtDetail representation (unsupported, inconclusive). */
  detail: SmtDetail | null;
  ms: number;
}

/**
 * Adaptive k: grow the bounds while the budget lasts. Never claims a k that did not complete: a step that times out
 * or answers unknown ends the run, and the result is the last step that completed (`unsat`), or that step's own
 * timeout/unknown with k = 0 when none completed. `sat`, `inconclusive` and `unsupported` end the run at their step.
 * A step whose answer is `unknown` because inputs inside its bounds need more than U iterations (coverage
 * `size-driven`, or `vacuous` with fuel) is retried at the same bounds with U doubled, up to MAX_UNROLL; every try is
 * in `attempts`, and the U a result was obtained at is its `unroll` (and in its `encodingNote`). Later steps start at
 * the largest U a completed step needed.
 */
export async function verifiedToK(original: FnUnderTest, candidate: FnUnderTest, opts: AdaptiveOptions): Promise<VerifiedToK> {
  const t0 = performance.now();
  const steps = opts.steps ?? DEFAULT_STEPS;
  const attempts: EquivResult[] = [];
  let lastUnsat: EquivResult | null = null;
  let final: EquivResult | null = null;
  // The unrolling bound carried forward: once a step needed a larger U, later (larger) steps start there.
  let carried = 0;
  steps: for (const s of steps) {
    let unroll = Math.max(s.unroll, carried);
    for (;;) {
      const remaining = opts.budgetMs - (performance.now() - t0);
      if (remaining <= 50) break steps;
      const r = await checkEquivalent(original, candidate, { ...s, unroll }, remaining, opts.z3, { sandbox: opts.sandbox, maxChars: opts.maxChars });
      attempts.push(r);
      // Inputs inside these bounds need more than U iterations (with every integer in [-1, 1], or no input finishes at all):
      // the bounds are not covered at this U. Retry the same bounds with a larger U, up to MAX_UNROLL.
      const needsMoreU = r.status === 'unknown' && (r.coverage?.kind === 'size-driven' || (r.coverage?.kind === 'vacuous' && r.coverage.fuel === true));
      if (needsMoreU && unroll * 2 <= MAX_UNROLL) {
        unroll *= 2;
        continue;
      }
      if (r.status === 'unsat') {
        lastUnsat = r;
        carried = unroll;
        continue steps;
      }
      if (r.status === 'sat' || r.status === 'inconclusive' || r.status === 'unsupported') final = r;
      break steps;
    }
  }
  if (!final) {
    if (lastUnsat) final = lastUnsat;
    else {
      const last = attempts[attempts.length - 1];
      final = last
        ? { ...last, k: 0, reason: `no bound completed: ${last.reason ?? last.status}` }
        : {
            status: 'timeout',
            k: 0,
            bounds: { array: 0, string: 0, int: 0 },
            unroll: 0,
            ms: 0,
            solveMs: 0,
            z3: opts.z3.info(),
            reason: 'the budget allowed no attempt',
            encodingNote: 'nothing was checked',
          };
    }
  }
  const stopped = attempts.length > 0 && attempts[attempts.length - 1] !== final ? attempts[attempts.length - 1]! : null;
  let detail: SmtDetail | null = null;
  if (final.status === 'unsat' || final.status === 'sat' || final.status === 'unknown' || final.status === 'timeout') {
    detail = {
      stage: 'smt',
      k: final.k,
      bounds: final.bounds,
      budgetMs: opts.budgetMs,
      z3: final.z3,
      result: final.status,
      encoding:
        final.encodingNote +
        (stopped ? ` The next bounds (arrays ${stopped.bounds.array}, strings ${stopped.bounds.string}, integers ±${stopped.bounds.int}, U = ${stopped.unroll}) did not complete: ${stopped.reason ?? stopped.status}.` : '') +
        (final.k === 0 && final.status !== 'unsat' && final.status !== 'sat' ? ' No bound completed; nothing is claimed.' : ''),
    };
  }
  return { result: final, attempts, detail, ms: performance.now() - t0 };
}
