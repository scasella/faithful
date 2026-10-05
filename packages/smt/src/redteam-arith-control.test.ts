/**
 * Red team, round 1, area arith-control (integer semantics, range checks, unrolled loops and fuel, recursion, early
 * return/break/continue, throw sites, Option results, candidate range violations vs an in-range original).
 *
 * Cases: packages/smt/redteam/arith-control/*.case. Header lines:
 *   `// @fn <name>`        the function to translate in both sources
 *   `// @expect diff | equal | equal-within-U | not-unsat | refused`
 *   `// @bounds <JSON EquivBounds[]>`   every bound the case is checked at
 *   `// @domain {"ints":[...]}`         integer values for ground truth (default: every integer in [-int, int])
 *   `// @inputs <JSON argument lists>`  explicit ground-truth inputs (non-exhaustive: big-integer cases)
 *   then `// ---- original` and `// ---- candidate` sections.
 *
 * Ground truth: both range-instrumented functions run in the sandbox on EVERY input of the domain within the bounds
 * (arrays up to the array bound over the integer domain), so for small bounds the truth set is exhaustive.
 *   diff            checkEquivalent answers `sat`, the replayed outcomes differ, the original is in the model.
 *   equal           checkEquivalent answers `unsat`, and exhaustive ground truth finds no difference.
 *   equal-within-U  `unsat` is the documented answer (the difference needs more than U iterations).
 *   not-unsat       the CORRECT behavior for a pair whose every input is excluded by the fuel/range assumptions: the
 *                   tier must not answer `unsat` ("Verified to k") over an empty verified set. These FAIL today
 *                   (finding V1); they are deliberately not `it.fails`.
 *   refused         the translator refuses one side (not an encoder probe; kept to document the attempt).
 * Every case is also run through the encoder on concrete inputs (sanity mode on the adversarial domain): the encoder's
 * outcome must equal the instrumented function's outcome wherever the encoder did not reach U.
 *
 * Round 2 (files `r2*.case`, 61 probes; round-1 reproducers re-run and all pass). New findings, failing on purpose:
 *   R2-V4  (A, label)  the coverage check's "all integers 0" split classifies a SIZE-driven exclusion as int-driven when
 *          the all-zero input never reaches the loop (an early return/throw or a violation at 0): r2v01, r2v02, r2v07,
 *          r2v08 answer `unsat` and verifiedToK reports SmtDetail { k: 6, result: 'unsat' } although the pair differs
 *          on (1, [0]) / [[1]], a one-element array.
 *   R2-L1  (label)     a loop with exactly U iterations is excluded (its exit test is the (U+1)-th activation), while
 *          encodingNote says "finish within U iterations": r2v09.
 *
 * Round 3 (files `r3*.case`, plus the mutation fuzz over `redteam/arith-control/fuzz-seeds.json`; every round-1/2
 * reproducer re-run first: 150 of 150 pass). New expectation kinds, because since round 2 an `unsat` may come back
 * with `bounds.int` NARROWED (coverage int-driven):
 *   narrowed           `unsat` with `coverage.intBound` < the requested integer bound; the pair differs only outside it.
 *   equal-or-narrowed  `unsat` (full or narrowed); never `sat`.
 * and one universal soundness assertion for every case: an `unsat` has NO ground-truth difference inside the box it
 * reports (arrays/strings as requested, integers within the reported, possibly narrowed, bound). Round 3 found no new
 * soundness or replay bug in this area; see the report for the probe list.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Sandbox, generateMutants, liveSandboxWorkers, outcomeEqual } from '@faithful/engine';
import { translateWithIr, type Outcome, type Translation, type Ty, type Val } from '@faithful/translate';
import { Encoder } from './encode.js';
import { checkEquivalent, verifiedToK, type EquivBounds, type FnUnderTest } from './equivalence.js';
import { declareInput, type Bounds } from './inputs.js';
import { decodeOutcome, lookup, outcomeTerms, type EncodedOutcome } from './outcome.js';
import { runInstrumented } from './replay.js';
import { readAnswers, transcript } from './sexpr.js';
import { Smt, and } from './terms.js';
import { eqConst } from './values.js';
import { openSystemZ3, openWasmZ3, type Z3Driver } from './z3.js';

const here = dirname(fileURLToPath(import.meta.url));
const DIR = join(here, '../redteam/arith-control');

interface Case {
  name: string;
  fn: string;
  expect: 'diff' | 'equal' | 'equal-within-U' | 'not-unsat' | 'refused' | 'narrowed' | 'equal-or-narrowed';
  bounds: EquivBounds[];
  ints: number[] | null;
  inputs: Val[][] | null;
  original: string;
  candidate: string;
}

function parseCase(text: string, name: string): Case {
  const head: Record<string, string> = {};
  for (const m of text.matchAll(/^\/\/ @(\w+) (.*)$/gm)) head[m[1]!] = m[2]!.trim();
  const parts = text.split(/^\/\/ -{3,} (?:original|candidate)\s*$/m);
  return {
    name,
    fn: head.fn ?? 'f',
    expect: head.expect as Case['expect'],
    bounds: JSON.parse(head.bounds!) as EquivBounds[],
    ints: head.domain ? (JSON.parse(head.domain) as { ints: number[] }).ints : null,
    inputs: head.inputs ? (JSON.parse(head.inputs) as Val[][]) : null,
    original: parts[1]!.trim(),
    candidate: parts[2]!.trim(),
  };
}

const CASES: Case[] = readdirSync(DIR)
  .filter((f) => f.endsWith('.case'))
  .sort()
  .map((f) => parseCase(readFileSync(join(DIR, f), 'utf8'), f.replace(/\.case$/, '')));

function fnut(src: string, name: string): FnUnderTest | null {
  const w = translateWithIr(src, name);
  if (!w.result.ok || !w.ir) return null;
  return { translation: w.result, ir: w.ir };
}

function valuesOf(ty: Ty, ints: number[] | null, b: Bounds): Val[] {
  switch (ty.k) {
    case 'int': {
      if (ints) return ints.filter((x) => Math.abs(x) <= b.int);
      const out: Val[] = [];
      for (let i = -b.int; i <= b.int; i++) out.push(i);
      return out;
    }
    case 'bool':
      return [false, true];
    case 'string': {
      const out: Val[] = [''];
      let layer: string[] = [''];
      for (let n = 1; n <= b.string; n++) {
        layer = layer.flatMap((x) => ['a', 'b'].map((c) => x + c));
        out.push(...layer);
      }
      return out;
    }
    case 'tuple': {
      let acc: Val[][] = [[]];
      for (const e of ty.elems) {
        const vs = valuesOf(e, ints, b);
        acc = acc.flatMap((a) => vs.map((v) => [...a, v]));
      }
      return acc;
    }
    case 'record': {
      let acc: Array<Record<string, Val>> = [{}];
      for (const fl of ty.fields) {
        const vs = valuesOf(fl.ty, ints, b);
        acc = acc.flatMap((a) => vs.map((v) => ({ ...a, [fl.name]: v })));
      }
      return acc as Val[];
    }
    case 'array': {
      const el = valuesOf(ty.elem, ints, b);
      const out: Val[] = [[]];
      let layer: Val[][] = [[]];
      for (let n = 1; n <= b.array; n++) {
        layer = layer.flatMap((xs) => el.map((x) => [...xs, x]));
        out.push(...layer);
      }
      return out;
    }
    default:
      throw new Error(`ground-truth domain: ${ty.k}`);
  }
}

function enumerate(t: Translation, ints: number[] | null, b: Bounds): Val[][] {
  let acc: Val[][] = [[]];
  for (const p of t.params) {
    const vs = valuesOf(p.ty, ints, b);
    acc = acc.flatMap((a) => vs.map((v) => [...a, v]));
  }
  return acc;
}

/** The largest |integer| of an input (strings and booleans are not integers: the coverage box ignores them too). */
function maxAbs(v: Val | Val[]): number {
  if (typeof v === 'number') return Math.abs(v);
  if (Array.isArray(v)) return v.reduce<number>((m, x) => Math.max(m, maxAbs(x)), 0);
  if (v && typeof v === 'object') return Object.values(v as Record<string, Val>).reduce<number>((m, x) => Math.max(m, maxAbs(x)), 0);
  return 0;
}

/** Inputs where the original is inside the model and the instrumented outcomes differ. */
function truthDiffs(inputs: Val[][], oo: Outcome[], co: Outcome[]): Array<{ input: Val[]; original: Outcome; candidate: Outcome }> {
  const out: Array<{ input: Val[]; original: Outcome; candidate: Outcome }> = [];
  inputs.forEach((x, i) => {
    const o = oo[i]!;
    const c = co[i]!;
    if (o.tag !== 'ok' && o.tag !== 'throw') return;
    if (c.tag === 'fault') return;
    if (!outcomeEqual(o, c)) out.push({ input: x, original: o, candidate: c });
  });
  return out;
}

/** The encoder evaluated on concrete inputs, one `(reset)` block per input (as sanity mode does). */
async function encEval(f: FnUnderTest, inputs: Val[][], b: Bounds, unroll: number, z3: Z3Driver): Promise<EncodedOutcome[]> {
  const params = f.translation.params.map((p) => p.ty);
  const smt = new Smt({ maxChars: 20_000_000 });
  smt.emit('(set-option :produce-models true)');
  const shared = { msgs: [] as string[] };
  const ins = params.map((ty, i) => declareInput(smt, ty, b, `in${i}`));
  for (const x of ins) smt.assert(x.dom);
  const enc = new Encoder(smt, f.ir, { unroll, shared });
  const out = enc.run(ins.map((x) => x.v));
  const base = smt.text();
  const terms = outcomeTerms(out);
  const res: EncodedOutcome[] = [];
  for (let s = 0; s < inputs.length; s += 40) {
    const part = inputs.slice(s, s + 40);
    const script = part
      .map((args) => `(reset)\n${base}\n(assert ${and(...args.map((a, i) => eqConst(ins[i]!.v, a, params[i]!)))})\n(check-sat)\n(get-value (${terms.join(' ')}))`)
      .join('\n');
    const r = await z3.solve(script, { timeoutMs: 120_000 });
    const { answers, errors } = readAnswers(transcript(r));
    expect(errors, 'solver errors in concrete evaluation').toEqual([]);
    part.forEach((_, j) => {
      const a = answers[j];
      if (!a || a.status !== 'sat' || !a.values) res.push({ tag: 'fault', detail: `encoder answered ${a?.status ?? 'nothing'}` });
      else res.push(decodeOutcome(out, f.translation.ret, enc, shared, lookup(terms, a.values)));
    });
  }
  return res;
}

const z3: Z3Driver | null = (await openSystemZ3()) ?? (await openWasmZ3());
let sandbox: Sandbox;
beforeAll(async () => {
  sandbox = await Sandbox.open();
});
afterAll(async () => {
  await sandbox?.close();
  expect(liveSandboxWorkers()).toBe(0);
});

/** Cases whose bounds need a deep unrolling; they run in their own test (V3: the encoder recurses on the JS stack). */
const DEEP = (k: Case) => k.bounds.some((b) => b.unroll > 100);

describe.skipIf(!z3)('red team arith-control: bounded equivalence against exhaustive ground truth', () => {
  for (const k of CASES.filter((x) => !DEEP(x))) {
    for (const b of k.bounds) {
      it(`${k.name} (${k.expect}) at arrays ${b.array}, ints ±${b.int}, U ${b.unroll}`, async () => {
        const o = fnut(k.original, k.fn);
        const c = fnut(k.candidate, k.fn);
        if (k.expect === 'refused') {
          expect(o === null || c === null).toBe(true);
          return;
        }
        expect(o, 'original translates').not.toBeNull();
        expect(c, 'candidate translates').not.toBeNull();
        const r = await checkEquivalent(o!, c!, b, 120_000, z3!, { sandbox });
        const inputs = k.inputs ?? enumerate(o!.translation, k.ints, b);
        const [oo, co] = await runInstrumented([o!.translation, c!.translation], inputs, { sandbox });
        const diffs = truthDiffs(inputs, oo!, co!);
        const msg = `${r.status} ${r.reason ?? ''} truth: ${diffs.length} differing of ${inputs.length}; first ${JSON.stringify(diffs[0] ?? null)}`;
        // universal (round 3): "Verified to k" must hold for every input inside the box the result REPORTS
        if (r.status === 'unsat') {
          expect(r.bounds.array).toBe(b.array);
          expect(r.bounds.string).toBe(b.string);
          expect(r.bounds.int).toBeLessThanOrEqual(b.int);
          const inside = diffs.filter((d) => maxAbs(d.input) <= r.bounds.int);
          expect(inside, `unsat at ints ±${r.bounds.int} (${r.coverage?.kind}) over a differing input: ${msg}`).toEqual([]);
          if (r.bounds.int < b.int) expect(r.encodingNote).toContain(`NARROWED to integers in [-${r.bounds.int}, ${r.bounds.int}]`);
        }
        switch (k.expect) {
          case 'diff': {
            expect(r.status, msg).toBe('sat');
            const cex = r.counterexample!;
            expect(outcomeEqual(cex.original, cex.candidate)).toBe(false);
            expect(['ok', 'throw']).toContain(cex.original.tag);
            expect(cex.candidate.tag).not.toBe('fault');
            if (!k.inputs) expect(diffs.length, msg).toBeGreaterThan(0);
            break;
          }
          case 'equal':
            expect(diffs, msg).toEqual([]);
            expect(r.status, msg).toBe('unsat');
            break;
          case 'equal-within-U':
            expect(r.status, msg).toBe('unsat');
            expect(r.encodingNote).toContain(`${b.unroll} iterations`);
            break;
          case 'narrowed':
            expect(r.status, msg).toBe('unsat');
            expect(r.coverage?.kind).toBe('int-driven');
            expect(r.bounds.int, msg).toBeLessThan(b.int);
            expect(r.coverage?.intBound).toBe(r.bounds.int);
            if (!k.inputs) expect(diffs.length, 'the pair does differ, beyond the narrowed bound').toBeGreaterThan(0);
            break;
          case 'equal-or-narrowed':
            expect(r.status, msg).toBe('unsat');
            break;
          case 'not-unsat':
            // V1 (round 1): the original reaches U (or leaves the model) on every input, so nothing was verified.
            // R2-V4 (round 2): inputs inside the bounds were excluded by U for a size-driven reason, labeled int-driven.
            expect(r.status, `"Verified to k" over an uncovered set: ${msg}; coverage ${JSON.stringify(r.coverage)}`).not.toBe('unsat');
            break;
        }

        // sanity mode on the adversarial domain: the encoder must agree with the instrumented functions
        const step = Math.max(1, Math.ceil(inputs.length / 200));
        const idx = inputs.map((_, i) => i).filter((i) => i % step === 0);
        const sample = idx.map((i) => inputs[i]!);
        for (const [which, f, ts] of [['original', o!, oo!], ['candidate', c!, co!]] as const) {
          const enc = await encEval(f, sample, b, b.unroll, z3!);
          const bad = idx.flatMap((i, j) => {
            const e = enc[j]!;
            const t = ts[i]!;
            if (e.tag === 'fuel' || t.tag === 'fault') return [];
            return outcomeEqual(e as Outcome, t) ? [] : [{ input: inputs[i], encoder: e, ts: t }];
          });
          expect(bad, `${which}: encoder vs instrumented execution`).toEqual([]);
        }
      }, 300_000);
    }
  }
});

describe.skipIf(!z3)('red team arith-control: the adaptive label', () => {
  it('V1: verifiedToK must not report "Verified to k" for a pair that differs on every input (fixed 12-step loop vs U <= 10)', async () => {
    const k = CASES.find((x) => x.name === 'v01VacuousFixedLoop')!;
    const v = await verifiedToK(fnut(k.original, k.fn)!, fnut(k.candidate, k.fn)!, { budgetMs: 60_000, z3: z3!, sandbox });
    // today: attempts unsat,unsat,unsat,unsat and detail { k: 6, result: 'unsat' }
    expect(v.detail?.result, JSON.stringify(v.attempts.map((a) => a.status))).not.toBe('unsat');
  }, 120_000);

  for (const name of ['r2v01ZeroGuardHidesSizeLoop', 'r2v02ElemGuardHidesSizeLoop']) {
    it(`R2-V4: ${name}: verifiedToK must not report "Verified to k" while the pair differs on a one-element array`, async () => {
      const k = CASES.find((x) => x.name === name)!;
      const o = fnut(k.original, k.fn)!;
      const c = fnut(k.candidate, k.fn)!;
      // ground truth: a small input inside the first default step (arrays <= 2, ints <= 16) where the outcomes differ
      const witness: Val[] = name === 'r2v01ZeroGuardHidesSizeLoop' ? [1, [0]] : [[1]];
      const [[ow], [cw]] = await runInstrumented([o.translation, c.translation], [witness], { sandbox });
      expect(outcomeEqual(ow!, cw!), `truth at ${JSON.stringify(witness)}`).toBe(false);
      const v = await verifiedToK(o, c, { budgetMs: 120_000, z3: z3!, sandbox });
      // today: unsat@U4, unsat@U6, unsat@U8, unsat@U10, every one coverage 'int-driven'; detail { k: 6, result: 'unsat' }
      const trail = v.attempts.map((a) => `${a.status}@A${a.bounds.array}/U${a.unroll}/${a.coverage?.kind ?? '-'}`).join(', ');
      expect(v.detail?.result, trail).not.toBe('unsat');
    }, 300_000);
  }
});

describe.skipIf(!z3)('red team arith-control: deep unrolling', () => {
  for (const k of CASES.filter(DEEP)) {
    it(`V3: ${k.name}: checkEquivalent returns a result (no JavaScript stack overflow) and a sat replays`, async () => {
      const o = fnut(k.original, k.fn)!;
      const c = fnut(k.candidate, k.fn)!;
      const b = k.bounds[0]!;
      // today: RangeError "Maximum call stack size exceeded" from Encoder.then/ev on the default stack
      const r = await checkEquivalent(o, c, b, 120_000, z3!, { sandbox });
      expect(['sat', 'unknown', 'timeout']).toContain(r.status);
      if (r.status === 'sat') {
        expect(r.counterexample!.input[0] as number).toBeGreaterThanOrEqual(500);
        expect(r.counterexample!.candidate).toMatchObject({ tag: 'range-violation' });
      }
    }, 300_000);
  }
});

/**
 * Round 3: mutation fuzz. Every seed of redteam/arith-control/fuzz-seeds.json (arithmetic/control-heavy functions)
 * against itself and its first engine mutants (seed 3), at the seed's small bounds, with EXHAUSTIVE ground truth. The
 * full run (`node packages/smt/redteam/arith-control/fuzz-r3.mjs 14`: 195 probes, plus the encoder on 400 concrete
 * inputs per function) found nothing; this test keeps a fast slice of it. gcdBounded is left out here: its symbolic
 * divisor makes Z3 answer unknown/timeout (conservative, never a claim), which only costs time.
 */
interface Seed {
  name: string;
  bounds: EquivBounds;
  source: string;
}
const SEEDS = JSON.parse(readFileSync(join(DIR, 'fuzz-seeds.json'), 'utf8')) as Seed[];

describe.skipIf(!z3)('red team arith-control round 3: mutation fuzz against exhaustive ground truth', () => {
  for (const seed of SEEDS.filter((x) => x.name !== 'gcdBounded')) {
    it(`${seed.name}: every unsat holds inside its reported box, every sat replays`, async () => {
      const o = fnut(seed.source, 'f')!;
      expect(o, 'seed translates').not.toBeNull();
      const b = seed.bounds;
      const inputs = enumerate(o.translation, null, b);
      const [oo] = await runInstrumented([o.translation], inputs, { sandbox });
      const { mutants } = generateMutants(seed.source, 'f', { seed: 3, max: 4 });
      const statuses: string[] = [];
      for (const m of [{ id: 'self', source: seed.source }, ...mutants]) {
        const c = fnut(m.source, 'f');
        if (!c) continue;
        const r = await checkEquivalent(o, c, b, 30_000, z3!, { sandbox });
        statuses.push(`${m.id}:${r.status}`);
        expect(r.status, `${m.id}: ${r.reason ?? ''}`).not.toBe('inconclusive');
        const [co] = await runInstrumented([c.translation], inputs, { sandbox });
        const diffs = truthDiffs(inputs, oo!, co!);
        if (r.status === 'unsat') {
          const inside = diffs.filter((d) => maxAbs(d.input) <= r.bounds.int);
          expect(inside, `${m.id}: unsat at ints ±${r.bounds.int} over a differing input`).toEqual([]);
        }
        if (r.status === 'sat') {
          const cex = r.counterexample!;
          expect(outcomeEqual(cex.original, cex.candidate), `${m.id}: replay`).toBe(false);
          expect(diffs.some((d) => JSON.stringify(d.input) === JSON.stringify(cex.input)), `${m.id}: witness ${JSON.stringify(cex.input)} in the truth set`).toBe(true);
        }
        if (m.id === 'self') expect(r.status).toBe('unsat');
      }
      expect(statuses.length).toBeGreaterThan(1);
    }, 300_000);
  }
});

describe.skipIf(!z3)('red team arith-control round 3: the adaptive label under narrowing', () => {
  const loopN = 'export function f(n: number): number { let s = 0; for (let i = 0; i < n; i++) { s += 1; } return s; }';
  const twice = (at: number): string =>
    `export function f(n: number): number { let s = 0; for (let i = 0; i < 2 * n; i++) { s += 1; } if (s === ${at}) { return 0; } return Math.floor(s / 2); }`;

  it('a candidate-only exclusion that a later step covers ends in a replayed sat (n = 3 needs 6 candidate iterations)', async () => {
    const v = await verifiedToK(fnut(loopN, 'f')!, fnut(twice(6), 'f')!, { budgetMs: 120_000, z3: z3!, sandbox });
    // measured: unsat@A2/I2/U4 (int-driven), sat@A4/U6 with input [3]
    expect(v.attempts[0]!.status).toBe('unsat');
    expect(v.attempts[0]!.bounds.int).toBeLessThan(3);
    expect(v.detail?.result).toBe('sat');
    expect(v.result.counterexample!.input).toEqual([3]);
  }, 300_000);

  it('a difference no step reaches (n = 40) is never claimed: every unsat is narrowed below 40 and says so', async () => {
    const v = await verifiedToK(fnut(loopN, 'f')!, fnut(twice(80), 'f')!, { budgetMs: 120_000, z3: z3!, sandbox });
    // measured: unsat at ints ±2, ±2, ±4, ±4 (U 4, 6, 8, 10); detail { k: 6, bounds.int: 4 }
    for (const a of v.attempts) if (a.status === 'unsat') expect(a.bounds.int).toBeLessThan(40);
    expect(v.detail?.result).toBe('unsat');
    expect(v.detail!.bounds.int).toBeLessThanOrEqual(5);
    expect(v.detail!.encoding).toContain(`NARROWED to integers in [-${v.detail!.bounds.int}, ${v.detail!.bounds.int}]`);
  }, 300_000);
});
