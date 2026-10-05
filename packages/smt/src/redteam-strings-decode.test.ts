/**
 * Red-team round 1, area strings-decode (packages/smt): string encoding (BMP code units, charAt / s[i] / charCodeAt /
 * slice / indexOf / split / join / case maps / ascii precondition / string order / number-to-string), counterexample
 * decoding into `Val` (negative integers, integers at and near ±2^53, records, options, tuples, string arrays, strings
 * with escapes) and replay fidelity.
 *
 * The probe pairs are in packages/smt/redteam/strings-decode/cases.mjs. Every expectation below encodes the CORRECT
 * behaviour, with ground truth from the sandbox (range-instrumented original and candidate) over a domain inside the
 * query's bounds; failing tests are left failing for the fixer:
 *   different  `sat`, the replayed outcomes differ, and the encoder's predicted outcomes equal the replayed ones
 *              (and the decoded input equals `expectInput` when given)
 *   equal      `unsat`
 *   vacuous    never `unsat`: the pair differs on inputs inside the bounds that need more than U iterations
 *              (FAILS today: see "vacuous Verified to k" below)
 * Each case also gets the sanity-mode check on its ground-truth inputs (the encoding evaluated by Z3 on constants
 * against the instrumented original in the sandbox, for both functions), plus a few purpose-built adversarial inputs.
 *
 * Known failure (round 1): `checkEquivalent` asserts that neither run reaches the unrolling bound U and never checks
 * that ANY input inside the bounds satisfies that assumption. When every input needs more than U iterations (a loop
 * with a constant trip count above U, e.g. a 26-letter alphabet loop, or a trip count of at least charCode + 20), the
 * query is `unsat` over an empty domain and `verifiedToK` reports "Verified to 6" (`SmtDetail.result: 'unsat'`)
 * for functions that differ on every input.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Sandbox, liveSandboxWorkers, outcomeEqual } from '@faithful/engine';
import { translateWithIr, type Outcome, type Ty, type Val } from '@faithful/translate';
// @ts-expect-error plain-JS case file (data only)
import { CASES, strs } from '../redteam/strings-decode/cases.mjs';
// @ts-expect-error plain-JS case file (data only)
import { ADAPTIVE2, CASES2 } from '../redteam/strings-decode/cases2.mjs';
// @ts-expect-error plain-JS case file (data only)
import { CASES3 } from '../redteam/strings-decode/cases3.mjs';
// @ts-expect-error plain-JS case file (data only)
import { ADV3 } from '../redteam/strings-decode/adv3.mjs';
import { Encoder, type Shared } from './encode.js';
import { checkEquivalent, verifiedToK, type EquivBounds, type FnUnderTest } from './equivalence.js';
import { declareInput, type Bounds } from './inputs.js';
import { decodeOutcome, lookup, outcomeTerms, type EncodedOutcome } from './outcome.js';
import { runInstrumented } from './replay.js';
import { readAnswers, transcript } from './sexpr.js';
import { Smt, and } from './terms.js';
import { eqConst } from './values.js';
import { openZ3, type Z3Driver } from './z3.js';

interface Case {
  id: string;
  kind: 'different' | 'equal' | 'vacuous';
  concrete?: Val[][];
  original: string;
  candidate: string;
  bounds: EquivBounds[];
  truth: () => Val[][];
  expectInput?: Val[];
}

const cases = CASES as Case[];

function fn(source: string): FnUnderTest {
  const w = translateWithIr(source, 'f');
  if (!w.result.ok || !w.ir) throw new Error(`probe not translated: ${JSON.stringify(w.result)}`);
  return { translation: w.result, ir: w.ir };
}

let z3: Z3Driver;
let sandbox: Sandbox;
beforeAll(async () => {
  z3 = await openZ3('system');
  sandbox = await Sandbox.open();
});
afterAll(async () => {
  await sandbox?.close();
  expect(liveSandboxWorkers()).toBe(0);
});

/** Ground truth: inputs (inside the bounds) where the instrumented original is inside the model and the outcomes differ. */
async function truthDiffs(o: FnUnderTest, c: FnUnderTest, inputs: Val[][]): Promise<Val[][]> {
  const [ro, rc] = await runInstrumented([o.translation, c.translation], inputs, { sandbox });
  const out: Val[][] = [];
  inputs.forEach((x, i) => {
    const a = ro![i]!;
    const b = rc![i]!;
    if (a.tag === 'fault' || a.tag === 'range-violation') return;
    if (!outcomeEqual(a, b)) out.push(x);
  });
  return out;
}

function shapeOf(v: Val): { array: number; string: number } {
  if (typeof v === 'string') return { array: 0, string: v.length };
  let array = 0;
  let string = 0;
  const kids = Array.isArray(v) ? v : v !== null && typeof v === 'object' ? Object.values(v) : [];
  if (Array.isArray(v)) array = v.length;
  for (const k of kids) {
    const s = shapeOf(k);
    array = Math.max(array, s.array);
    string = Math.max(string, s.string);
  }
  return { array, string };
}

/**
 * Sanity mode on chosen inputs: the encoding of `f`, evaluated by Z3 with the input asserted as constants, against
 * the instrumented function in the sandbox. Returns the mismatches (inputs the encoder reached U on are skipped).
 */
async function concreteMismatches(f: FnUnderTest, inputs: Val[][], unroll = 14): Promise<Array<{ input: Val[]; ts: Outcome; encoder: EncodedOutcome | string }>> {
  const params: Ty[] = f.translation.params.map((p) => p.ty);
  // the shape of the arguments (not of the list of inputs itself, which would size every array by the input count)
  const sh = inputs.flat(1).map(shapeOf).reduce((m, x) => ({ array: Math.max(m.array, x.array), string: Math.max(m.string, x.string) }), { array: 0, string: 0 });
  const b: Bounds = { array: Math.max(1, sh.array), string: Math.max(1, sh.string), int: 2 ** 53 };
  const smt = new Smt({ maxChars: 30_000_000 });
  smt.emit('(set-option :produce-models true)');
  const shared: Shared = { msgs: [] };
  const ins = params.map((ty, i) => declareInput(smt, ty, b, `in${i}`));
  for (const x of ins) smt.assert(x.dom);
  const enc = new Encoder(smt, f.ir, { unroll, shared });
  const out = enc.run(ins.map((x) => x.v));
  const base = smt.text();
  const terms = outcomeTerms(out);
  const script = inputs
    .map((a) => `(reset)\n${base}\n(assert ${and(...a.map((v, i) => eqConst(ins[i]!.v, v, params[i]!)))})\n(check-sat)\n(get-value (${terms.join(' ')}))`)
    .join('\n');
  const r = await z3.solve(script, { timeoutMs: 120_000 });
  const { answers, errors } = readAnswers(transcript(r));
  expect(errors).toEqual([]);
  const [ts] = await runInstrumented([f.translation], inputs, { sandbox });
  const bad: Array<{ input: Val[]; ts: Outcome; encoder: EncodedOutcome | string }> = [];
  inputs.forEach((a, i) => {
    const ans = answers[i];
    const t = ts![i]!;
    if (!ans || ans.status !== 'sat' || !ans.values) {
      bad.push({ input: a, ts: t, encoder: ans?.status ?? 'no answer' });
      return;
    }
    const e = decodeOutcome(out, f.translation.ret, enc, shared, lookup(terms, ans.values));
    if (e.tag === 'fuel' || t.tag === 'fault') return;
    if (!outcomeEqual(t, e)) bad.push({ input: a, ts: t, encoder: e });
  });
  return bad;
}

function sample<X>(xs: X[], n: number): X[] {
  if (xs.length <= n) return xs;
  const step = Math.ceil(xs.length / n);
  return xs.filter((_, i) => i % step === 0);
}

/** One probe: ground truth in the sandbox, the query at every listed bound, sanity mode on the truth inputs. */
async function runCase(c: Case): Promise<void> {
    const o = fn(c.original);
    const cand = fn(c.candidate);
    const truth = c.truth();
    const diffs = await truthDiffs(o, cand, truth);
    // the ground truth itself must match the case's kind (guards against a mislabelled probe)
    if (c.kind === 'equal') expect(diffs, 'ground truth: the pair agrees on every input in the domain').toEqual([]);
    else expect(diffs.length, 'ground truth: the pair differs on some input inside the bounds').toBeGreaterThan(0);
    if (c.expectInput) expect(diffs).toEqual([c.expectInput]);

    for (const b of c.bounds) {
      const r = await checkEquivalent(o, cand, b, 120_000, z3, { sandbox });
      const at = `${c.id} at ${JSON.stringify(b)}: ${r.status} ${r.reason ?? ''}`;
      if (c.kind === 'equal') {
        expect(r.status, at).toBe('unsat');
      } else if (c.kind === 'vacuous') {
        // the two functions differ on inputs inside these bounds; "Verified to k" would be false
        expect(r.status, `${at} (a difference exists inside the bounds; only inputs needing more than U = ${b.unroll} iterations show it)`).not.toBe('unsat');
      } else {
        expect(r.status, at).toBe('sat');
        const cx = r.counterexample!;
        expect(outcomeEqual(cx.original, cx.candidate), `${at}: replayed outcomes must differ`).toBe(false);
        expect(cx.original.tag === 'ok' || cx.original.tag === 'throw', `${at}: original inside the model`).toBe(true);
        // the encoding agrees with execution on Z3's own input
        expect(cx.predicted.original, `${at}: predicted original vs replay`).toEqual(cx.original);
        expect(cx.predicted.candidate, `${at}: predicted candidate vs replay`).toEqual(cx.candidate);
        if (c.expectInput) expect(cx.input, `${at}: decoded counterexample`).toEqual(c.expectInput);
      }
    }

    // sanity mode on the ground-truth inputs, both functions
    const pts = [...sample(truth, 60), ...(c.concrete ?? [])];
    expect(await concreteMismatches(o, pts), `${c.id}: original`).toEqual([]);
    expect(await concreteMismatches(cand, pts), `${c.id}: candidate`).toEqual([]);
}

describe('red team strings-decode: equivalence probes', () => {
  it.each(cases.map((c) => [c.id, c] as const))('%s', async (_id, c) => runCase(c), 600_000);
});

describe('red team strings-decode: vacuous "Verified to k"', () => {
  it('verifiedToK does not report unsat for a pair that differs on every input (constant trip count 12 > U)', async () => {
    const c = cases.find((x) => x.id === 'vac-const-loop-string')!;
    const o = fn(c.original);
    const cand = fn(c.candidate);
    // ground truth: they differ on EVERY string (the original prefixes twelve "a"s)
    const all = (strs(['a', 'b', '￿'], 3) as string[]).map((s) => [s] as Val[]);
    expect((await truthDiffs(o, cand, all)).length).toBe(all.length);
    const v = await verifiedToK(o, cand, { budgetMs: 120_000, z3, sandbox });
    // today: result 'unsat', k = 6, detail.result 'unsat' ("Verified to 6") although no input inside the bounds was covered
    expect(v.result.status).not.toBe('unsat');
    expect(v.detail?.result).not.toBe('unsat');
  }, 300_000);
});

describe('red team strings-decode: sanity mode on adversarial inputs', () => {
  const P53 = 2 ** 53;
  const ADV: Array<[string, string, Val[][]]> = [
    [
      'template of escaped text and ±2^53',
      'export function f(s: string, n: number): string { return `${n}|${s}|${s.length}|${-n}`; }',
      [['\u0000"\\\n￿', -P53], ['', P53], ['퟿', -1], ['  \t\r', P53 - 1], ['a', 0]],
    ],
    [
      'char codes of every unit',
      'export function f(s: string): number[] { return s.split("").map((c) => c.charCodeAt(0)); }',
      [['\u0000\u007f\u0080퟿'], ['￿'], [''], ['"\\']],
    ],
    [
      'case maps and sort, ascii and non-ascii',
      'export function f(xs: string[]): string[] { return xs.map((x) => x.toUpperCase()).sort(); }',
      [[['b', 'A', '`{@[']], [['é']], [['z', '\u007f']], [[]]],
    ],
    [
      'split on a symbolic separator with escapes',
      'export function f(s: string, t: string): string[] { return s.split(t); }',
      [['a\u0000b\u0000', '\u0000'], ['￿￿￿', '￿￿'], ['', ''], ['x', ''], ['"', '"']],
    ],
    [
      'record and option output with escaped strings',
      'export function f(xs: string[], n: number): { s: string; n: number } | null { return xs.length === 0 ? null : { s: xs.join("\\n"), n: n * 2 }; }',
      [[['\u0000', '"'], 2 ** 52], [[], 1], [['￿'], -(2 ** 52)], [['a', 'b'], 2 ** 52 + 1]],
    ],
    [
      'slice and indexOf with extreme positions',
      'export function f(s: string, a: number): string { return s.slice(a) + "|" + s.indexOf("", a) + "|" + s.charAt(a); }',
      [['abc', -P53], ['abc', P53], ['', 0], ['￿x', -1]],
    ],
  ];
  it.each(ADV)('%s', async (_name, src, inputs) => {
    const f = fn(src);
    expect(await concreteMismatches(f, inputs)).toEqual([]);
  }, 300_000);
});

/*
 * Red-team round 2 (strings-decode). Every round-1 probe above was re-run first (90 tests, all green: the round-1
 * fixes hold). The probes below are new; see packages/smt/redteam/strings-decode/cases2.mjs for the families. Every
 * expectation is the CORRECT behaviour with sandbox ground truth; at the time of writing all of them hold.
 */
const cases2 = CASES2 as Case[];

describe('red team strings-decode round 2: equivalence probes', () => {
  it.each(cases2.map((c) => [c.id, c] as const))('%s', async (_id, c) => runCase(c), 600_000);
});

describe('red team strings-decode round 2: adaptive k finds a difference that needs the largest string bound', () => {
  const adaptive = ADAPTIVE2 as Array<{ id: string; original: string; candidate: string; expectString: number }>;
  it.each(adaptive.map((c) => [c.id, c] as const))('%s', async (_id, c) => {
    const o = fn(c.original);
    const cand = fn(c.candidate);
    const v = await verifiedToK(o, cand, { budgetMs: 120_000, z3, sandbox });
    // every earlier step is a true unsat (no input shorter than expectString distinguishes them); the run must not stop early
    expect(v.result.status).toBe('sat');
    expect(v.result.bounds.string).toBe(c.expectString);
    const cx = v.result.counterexample!;
    expect((cx.input[0] as string).length).toBe(c.expectString);
    expect(outcomeEqual(cx.original, cx.candidate)).toBe(false);
    expect(cx.predicted.original).toEqual(cx.original);
    expect(cx.predicted.candidate).toEqual(cx.candidate);
    expect(v.attempts.slice(0, -1).every((a) => a.status === 'unsat')).toBe(true);
    expect(v.detail?.result).toBe('sat');
  }, 300_000);
});

describe('red team strings-decode round 2: sanity mode on adversarial inputs', () => {
  const P53 = 2 ** 53;
  const ADV2: Array<[string, string, Val[][]]> = [
    [
      'number[].join at ±2^53 and with a negative element first',
      'export function f(xs: number[]): string { return xs.join("") + "|" + xs.join() + "|" + xs.map((x) => -x).join("-"); }',
      [[[-P53, P53, 0]], [[P53 - 1, -(P53 - 1)]], [[]], [[-1]], [[10, -10, 100000]]],
    ],
    [
      'String(n) compared as strings at the digit boundaries',
      'export function f(n: number, m: number): number { return (%%#{n}%% < %%#{m}%% ? 1 : 0) + (%%#{n}%%.length === %%#{m}%%.length ? 2 : 0) + %%#{n}%%.indexOf("9"); }'.replaceAll('%%', '`').replaceAll('#{', '${'),
      [[P53, P53 - 1], [-P53, -1], [9, 10], [-9, -10], [999999999999999, 1e15], [0, -0]],
    ],
    [
      'split on a separator derived from the input',
      'export function f(s: string): string[] { return s.split(s.slice(-2)).concat(s.split(s)).concat(s.split(s.charAt(1))); }',
      [['abab'], ['aaaa'], [''], ['a'], ['\u2028\u2028\u2028'], ['\uffff\u0000\uffff\u0000'], ['xyzxy']],
    ],
    [
      'slice / indexOf / charAt through -1 and ±2^53',
      'export function f(s: string, n: number): string { return s.slice(s.indexOf(",")) + "|" + s.charAt(s.indexOf(",", n)) + "|" + s.slice(n, -n) + "|" + s.indexOf("", n); }',
      [['a,b', P53], ['a,b', -P53], ['', 0], ['abc', 1], [',,,', -1], ['\ufeff,', 2]],
    ],
    [
      'records and options with odd field names and escaped strings',
      'export function f(s: string): { "a b": string; then: number; toJSON: string } | null { return s.length === 0 ? null : { "a b": s + "\\n", then: s.length, toJSON: s.toUpperCase() }; }',
      [['"'], [''], ['\u0000x'], ['a\r\n'], ['\\']],
    ],
    [
      'overflowing string hash (the range check detail is part of the outcome)',
      'export function f(s: string): number { let h = 0; for (let i = 0; i < s.length; i++) { h = h * 65536 + s.charCodeAt(i); } return h; }',
      [['\uffff\uffff\uffff\uffff'], ['\u0001\u0000\u0000\u0000'], ['\u0000\uffff\uffff\uffff'], ['\u001f\uffff\uffff\uffff'], ['\u0020\u0000\u0000\u0000'], ['']],
    ],
  ];
  it.each(ADV2)('%s', async (_name, src, inputs) => {
    const f = fn(src);
    expect(await concreteMismatches(f, inputs)).toEqual([]);
  }, 300_000);
});

/*
 * Red-team round 3 (strings-decode). Rounds 1 and 2 were re-run first (140 tests, all green). The probes below are new
 * (packages/smt/redteam/strings-decode/cases3.mjs and adv3.mjs): split with a symbolic separator against indexOf
 * loops, join after every operation that carries the `sum` truncation bound, indexOf(t, i) vs slice(i).indexOf(t) + i,
 * string order on concatenations and slices, case maps, intToStr digits at ±2^53, decoding of tuples / nested records
 * / Option<tuple> / numeric record keys, and coverage of loops whose trip count is driven by strings nested in
 * records, tuples and arrays (kind 'vacuous': never `unsat`). Every expectation is the CORRECT behaviour with sandbox
 * ground truth; at the time of writing all of them hold (no new bug found this round).
 */
const cases3 = CASES3 as Case[];

describe('red team strings-decode round 3: equivalence probes', () => {
  it.each(cases3.map((c) => [c.id, c] as const))('%s', async (_id, c) => runCase(c), 600_000);
});

describe('red team strings-decode round 3: sanity mode on adversarial inputs', () => {
  it.each(ADV3 as Array<[string, string, Val[][]]>)('%s', async (_name, src, inputs) => {
    const f = fn(src);
    expect(await concreteMismatches(f, inputs)).toEqual([]);
  }, 300_000);
});
