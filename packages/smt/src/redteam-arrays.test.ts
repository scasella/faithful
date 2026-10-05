/**
 * SMT red team, round 1, area "arrays" (2026-10-05). Every file in packages/smt/redteam/arrays/ is one probe: a pair
 * `original` / `candidate` of in-subset functions, with the CORRECT verdict in its header. A failing test here is a
 * confirmed soundness bug of the SMT tier and stays failing until the encoder/driver is fixed (never weaken it).
 *
 * Header lines (`// @smt-redteam ...`):
 *   expect=equal|differ        ground truth (checked here too, by brute force in the sandbox)
 *   bounds={"array":A,"string":S,"int":B}   bounds for brute force AND for checkEquivalent (unroll 12 unless `unroll=`)
 *   chars=[...]                alphabet for brute-force strings (default ["a","b"])
 *   adv=[[args]...]            hand-picked inputs for the concrete encoder check, at integers up to ±2^53
 *   mode=adaptive witness=[args]   run verifiedToK with DEFAULT_STEPS instead; `witness` is an input inside the
 *                              default bounds on which the two functions differ (checked in the sandbox)
 *
 * Per (non-adaptive) probe:
 *   1. brute force over ALL inputs within `bounds` (alphabet-restricted strings) on both instrumented functions:
 *      a difference exists iff expect=differ (validates the probe);
 *   2. checkEquivalent at `bounds`: expect=differ -> `sat` with a replay-confirmed counterexample; expect=equal ->
 *      `unsat` (a `sat` would be a non-replaying counterexample, an `unsat` on a differing pair a false claim);
 *   3. concrete mode: the encoding of each function, with the input fixed, gives exactly the instrumented original's
 *      outcome on a sample of the enumerated inputs and on the `adv` inputs.
 * Per adaptive probe: verifiedToK must not answer `unsat` at bounds that contain the witness.
 *
 * Round 1 result: 57 probes, 55 held. Confirmed (both adaptive, both from the fuel exclusion in equivalence.ts):
 *   fuelConcatIndexLoopDiffer, fuelSquareIndexLoopDiffer: `unsat`, "Verified to k = 6" with a distinguishing input of
 *   array length 6+5 / 4, inside the stated bounds, because inputs needing more than U = 10 loop iterations are
 *   asserted away (`ne(rc.st, ST_FUEL)` and the original's status constraint) while k and the bounds are reported as if
 *   every input up to them was covered.
 *
 * Round 2 (2026-10-05, files r2*.ts). Re-run first: all 57 round-1 probes pass (58 tests, both round-1 findings fixed by
 * the coverage check). Then 55 new probes (54 per-pair + 1 adaptive), 54 held. Additionally, sanity mode
 * (`sanityCheck`, 40 generated inputs per function, arrays <= 6, strings <= 8, integers incl. +-2^53) over both
 * functions of every r2 probe (110 functions, 4,400 inputs: 4,207 compared, 33 fuel, 160 not compared because the
 * encodings of r2JoinSplitCount{Eq,Differ} and r2NestedJoin{Eq,EmptyRowDiffer} originals exceed 8 MB at arrays 6; re-run at
 * 40 MB with 12 inputs each for r2JoinSplitCountEq / r2NestedJoinEq: 24 compared, ~70-95 s per function) and of all
 * round-1 probes (114 functions, 4,560 inputs, 4,551 compared, 9 fuel): 0 mismatches against the instrumented
 * original, 0 solver misses, every uniqueness check unsat. Confirmed (adaptive):
 *   r2MergeCapIntGatedDiffer: verifiedToK answers unsat, "Verified to k = 6" (arrays 6, strings 8, ints +-2^16, U = 10),
 *   coverage "int-driven", although the witness [[1,3,5,7,9,11],[2,4,6,8,10,12]] lies inside those bounds and the
 *   replayed outcomes differ. The two-pointer merge's trip count is driven by the array LENGTHS (up to 12 > U) but is
 *   short when every integer is 0, so `coverageCheck`'s "all integers 0" split classifies the exclusion as
 *   integer-driven and verifiedToK never raises U for it. (The encodingNote does disclose that inputs were excluded,
 *   with an example; the headline k does not.)
 *
 * Round 3 (2026-10-05, files r3*.ts). Re-run first: all 112 round-1/2 probes pass (114 tests; r2MergeCapIntGatedDiffer
 * and both round-1 fuel findings stay fixed: verifiedToK narrows the integer bound instead of claiming the witness).
 * Then 45 new probes (43 per-pair + 2 adaptive), 45 held, no new finding. Families: sort key paths through
 * tuple-in-record / record-in-tuple, chained stable sorts = lexicographic order, descending vs reversed ascending
 * (equal on primitives, differ on records), slice/concat identities at negative and out-of-range indices, slice(1, -1)
 * vs filterI, join-equality (equal for number arrays, differ for string arrays), argmin via mapI + sort (first vs last
 * index), xs[xs.indexOf(v)] (original leaving the model is excluded; candidate leaving it is a difference), filter +
 * includes, nested-array firsts/lasts, reduce-to-string vs join, reduce index on a filtered array, a list literal sliced
 * to a literal length below its slot count, if-merges of nested arrays of different capacities, boolean arrays, loops
 * inside map/filter callbacks. Adaptive: r3CallbackLoopElemDiffer (fuel inside a map slot) is narrowed to integers
 * +-10 at U = 10 (witness [[50]] outside); r3GatedOtherIntLoopDiffer (length-driven loop gated by n >= 1000) is narrowed
 * to +-999 (witness n = 1000 outside). Sanity mode over every r3 function: see the report; 0 mismatches.
 * Fuzzers (fuzz-r3.mjs: number arrays; fuzz-r3-str.mjs: string arrays and [number, string][]) generate random in-subset
 * functions plus a one-step mutant each; every function goes through sanityCheck and every pair through
 * checkEquivalent, with every `unsat` checked against brute force over ALL inputs inside the bounds: no finding.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Sandbox, liveSandboxWorkers, outcomeEqual } from '@faithful/engine';
import { translateWithIr, type Ty, type Val } from '@faithful/translate';
import { Encoder, type Shared } from './encode.js';
import { DEFAULT_STEPS, checkEquivalent, verifiedToK, type FnUnderTest } from './equivalence.js';
import { declareInput, type Bounds } from './inputs.js';
import { decodeOutcome, lookup, outcomeTerms } from './outcome.js';
import { runInstrumented } from './replay.js';
import { readAnswers, transcript } from './sexpr.js';
import { Smt, and } from './terms.js';
import { eqConst } from './values.js';
import { openZ3, type Z3Driver } from './z3.js';

const here = dirname(fileURLToPath(import.meta.url));
const DIR = join(here, '../redteam/arrays');
const P53 = 2 ** 53;

interface Probe {
  file: string;
  source: string;
  expect: 'equal' | 'differ';
  adaptive: boolean;
  bounds?: Bounds;
  chars: string[];
  adv: Val[][];
  unroll: number;
  witness?: Val[];
}

function load(): Probe[] {
  const out: Probe[] = [];
  for (const file of readdirSync(DIR).filter((f) => f.endsWith('.ts')).sort()) {
    const source = readFileSync(join(DIR, file), 'utf8');
    const kv: Record<string, string> = {};
    for (const line of source.split('\n')) {
      const m = /^\/\/ @smt-redteam (.*)$/.exec(line.trimEnd());
      if (!m) continue;
      for (const x of m[1]!.match(/(\w+)=(\[.*\]|\{.*?\}|\S+)/g) ?? []) {
        const i = x.indexOf('=');
        kv[x.slice(0, i)] = x.slice(i + 1);
      }
    }
    if (kv.expect !== 'equal' && kv.expect !== 'differ') throw new Error(`${file}: missing expect=`);
    out.push({
      file,
      source,
      expect: kv.expect,
      adaptive: kv.mode === 'adaptive',
      bounds: kv.bounds ? (JSON.parse(kv.bounds) as Bounds) : undefined,
      chars: kv.chars ? (JSON.parse(kv.chars) as string[]) : ['a', 'b'],
      adv: kv.adv ? (JSON.parse(kv.adv) as Val[][]) : [],
      unroll: kv.unroll ? Number(kv.unroll) : 12,
      witness: kv.witness ? (JSON.parse(kv.witness) as Val[]) : undefined,
    });
  }
  return out;
}

function fn(source: string, name: string): FnUnderTest {
  const w = translateWithIr(source, name);
  if (!w.result.ok || !w.ir) throw new Error(`${name} not translated: ${JSON.stringify(w.result)}`);
  return { translation: w.result, ir: w.ir };
}

function product(lists: Val[][]): Val[][] {
  let out: Val[][] = [[]];
  for (const l of lists) out = out.flatMap((p) => l.map((x) => [...p, x]));
  return out;
}

/** Every value of `ty` within `b` (strings over `chars`). */
function enumerate(ty: Ty, b: Bounds, chars: string[]): Val[] {
  switch (ty.k) {
    case 'int': {
      const o: Val[] = [];
      for (let i = -b.int; i <= b.int; i++) o.push(i);
      return o;
    }
    case 'bool':
      return [false, true];
    case 'string': {
      const out: string[] = [''];
      let layer = [''];
      for (let l = 1; l <= b.string; l++) {
        layer = layer.flatMap((s) => chars.map((c) => s + c));
        out.push(...layer);
      }
      return out;
    }
    case 'array': {
      const el = enumerate(ty.elem, b, chars);
      const out: Val[][] = [[]];
      let layer: Val[][] = [[]];
      for (let l = 1; l <= b.array; l++) {
        layer = layer.flatMap((s) => el.map((e) => [...s, e]));
        out.push(...layer);
      }
      return out;
    }
    case 'tuple':
      return product(ty.elems.map((e) => enumerate(e, b, chars)));
    case 'record':
      return product(ty.fields.map((f) => enumerate(f.ty, b, chars))).map((vs) => Object.fromEntries(ty.fields.map((f, i) => [f.name, vs[i]!])));
    case 'option':
      throw new Error('option parameter');
  }
}

/** Smallest bounds containing `inputs` (integers up to ±2^53). */
function shapeOf(inputs: Val[][], params: Ty[]): Bounds {
  let array = 1;
  let string = 1;
  const visit = (v: Val, ty: Ty): void => {
    if (ty.k === 'string') string = Math.max(string, (v as string).length);
    else if (ty.k === 'array') {
      array = Math.max(array, (v as Val[]).length);
      for (const x of v as Val[]) visit(x, ty.elem);
    } else if (ty.k === 'tuple') ty.elems.forEach((e, i) => visit((v as Val[])[i]!, e));
    else if (ty.k === 'record') for (const f of ty.fields) visit((v as Record<string, Val>)[f.name]!, f.ty);
  };
  for (const a of inputs) a.forEach((x, i) => visit(x, params[i]!));
  return { array, string, int: P53 };
}

function fits(input: Val[], params: Ty[], b: Bounds): boolean {
  const s = shapeOf([input], params);
  const ints: number[] = [];
  const visit = (v: Val, ty: Ty): void => {
    if (ty.k === 'int') ints.push(Math.abs(v as number));
    else if (ty.k === 'array') for (const x of v as Val[]) visit(x, ty.elem);
    else if (ty.k === 'tuple') ty.elems.forEach((e, i) => visit((v as Val[])[i]!, e));
    else if (ty.k === 'record') for (const f of ty.fields) visit((v as Record<string, Val>)[f.name]!, f.ty);
  };
  input.forEach((x, i) => visit(x, params[i]!));
  return s.array <= b.array && s.string <= b.string && ints.every((n) => n <= b.int);
}

/** Concrete mode: the encoding with the input fixed must give the instrumented original's outcome. */
async function concreteMismatches(f: FnUnderTest, inputs: Val[][], b: Bounds, unroll: number): Promise<unknown[]> {
  if (!inputs.length) return [];
  const params = f.translation.params.map((p) => p.ty);
  const smt = new Smt({ maxChars: 30_000_000 });
  smt.emit('(set-option :produce-models true)');
  const shared: Shared = { msgs: [] };
  const ins = params.map((ty, i) => declareInput(smt, ty, b, `in${i}`));
  for (const x of ins) smt.assert(x.dom);
  const enc = new Encoder(smt, f.ir, { unroll, shared });
  const out = enc.run(ins.map((x) => x.v));
  const base = smt.text();
  const terms = outcomeTerms(out);
  const [ts] = await runInstrumented([f.translation], inputs, { sandbox, perCallMs: 1000 });
  const bad: unknown[] = [];
  for (let s = 0; s < inputs.length; s += 25) {
    const idx = inputs.map((_, i) => i).slice(s, s + 25);
    const script = idx
      .map((i) => {
        const fix = and(...inputs[i]!.map((a, k) => eqConst(ins[k]!.v, a, params[k]!)));
        return `(reset)\n${base}\n(assert ${fix})\n(check-sat)\n(get-value (${terms.join(' ')}))`;
      })
      .join('\n');
    const r = await z3.solve(script, { timeoutMs: 120_000 });
    const { answers, errors } = readAnswers(transcript(r));
    if (errors.length) bad.push({ solverErrors: errors.slice(0, 2) });
    idx.forEach((i, j) => {
      const a = answers[j];
      if (!a || a.status !== 'sat' || !a.values) {
        bad.push({ input: inputs[i], encoder: a?.status ?? 'no answer' });
        return;
      }
      const e = decodeOutcome(out, f.translation.ret, enc, shared, lookup(terms, a.values));
      const t = ts![i]!;
      if (e.tag === 'fuel' || t.tag === 'fault') return;
      if (!outcomeEqual(t, e)) bad.push({ input: inputs[i], ts: t, encoder: e });
    });
  }
  return bad;
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

const PROBES = load();

describe('SMT red team: arrays', () => {
  it('has at least 30 probes', () => {
    expect(PROBES.length).toBeGreaterThanOrEqual(30);
  });

  it('round 2 adds at least 30 new probes', () => {
    expect(PROBES.filter((p) => p.file.startsWith('r2')).length).toBeGreaterThanOrEqual(30);
  });

  it('round 3 adds at least 30 new probes', () => {
    expect(PROBES.filter((p) => p.file.startsWith('r3')).length).toBeGreaterThanOrEqual(30);
  });

  for (const p of PROBES.filter((x) => !x.adaptive)) {
    it(`${p.file} (${p.expect})`, async () => {
      const o = fn(p.source, 'original');
      const c = fn(p.source, 'candidate');
      const b = p.bounds!;
      const params = o.translation.params.map((x) => x.ty);
      // 1. ground truth by brute force
      const inputs = product(params.map((t) => enumerate(t, b, p.chars)));
      expect(inputs.length).toBeLessThan(40_000);
      const [ro, rc] = await runInstrumented([o.translation, c.translation], inputs, { sandbox, perCallMs: 1000 });
      const diffs = inputs.filter((_, i) => {
        const a = ro![i]!;
        const d = rc![i]!;
        return a.tag !== 'fault' && a.tag !== 'range-violation' && d.tag !== 'fault' && !outcomeEqual(a, d);
      });
      expect(diffs.length > 0, `brute force over ${inputs.length} inputs: ${JSON.stringify(diffs[0])}`).toBe(p.expect === 'differ');
      // 2. the bounded equivalence query
      const r = await checkEquivalent(o, c, { ...b, unroll: p.unroll }, 120_000, z3, { sandbox });
      if (p.expect === 'differ') {
        expect(r.status, `${r.reason ?? ''} ${JSON.stringify(r.counterexample ?? null)}`).toBe('sat');
        expect(outcomeEqual(r.counterexample!.original, r.counterexample!.candidate)).toBe(false);
        expect(fits(r.counterexample!.input, params, b)).toBe(true);
      } else {
        expect(r.status, `${r.reason ?? ''} ${JSON.stringify(r.counterexample ?? null)}`).toBe('unsat');
      }
      // 3. concrete encoder vs execution
      const stride = Math.max(1, Math.floor(inputs.length / 120));
      const sample = inputs.filter((_, i) => i % stride === 0);
      const bad = [
        ...(await concreteMismatches(o, sample, b, p.unroll)),
        ...(await concreteMismatches(c, sample, b, p.unroll)),
      ];
      if (p.adv.length) {
        const bb = shapeOf(p.adv, params);
        bad.push(...(await concreteMismatches(o, p.adv, bb, p.unroll)), ...(await concreteMismatches(c, p.adv, bb, p.unroll)));
      }
      expect(bad, JSON.stringify(bad.slice(0, 3))).toEqual([]);
    }, 300_000);
  }

  for (const p of PROBES.filter((x) => x.adaptive)) {
    it(`${p.file} (adaptive, ${p.expect})`, async () => {
      const o = fn(p.source, 'original');
      const c = fn(p.source, 'candidate');
      const params = o.translation.params.map((x) => x.ty);
      const top = DEFAULT_STEPS[DEFAULT_STEPS.length - 1]!;
      const w = p.witness!;
      // the witness is inside the default bounds and distinguishes the pair in the sandbox
      expect(fits(w, params, top)).toBe(true);
      const [ro, rc] = await runInstrumented([o.translation, c.translation], [w], { sandbox });
      expect(ro![0]!.tag === 'ok' || ro![0]!.tag === 'throw').toBe(true);
      expect(outcomeEqual(ro![0]!, rc![0]!), JSON.stringify([ro![0], rc![0]])).toBe(false);
      // verifiedToK must not claim "Verified to k" at bounds that contain the witness
      const r = await verifiedToK(o, c, { budgetMs: 180_000, z3, sandbox });
      const claimsWitness = r.result.status === 'unsat' && fits(w, params, r.result.bounds);
      expect(
        claimsWitness,
        `verifiedToK answered unsat at k = ${r.result.k} ${JSON.stringify(r.result.bounds)} U = ${r.result.unroll}, ` +
          `but ${JSON.stringify(w)} lies inside those bounds and the replayed outcomes differ: ${JSON.stringify([ro![0], rc![0]])}`,
      ).toBe(false);
      if (r.result.status === 'sat') expect(outcomeEqual(r.result.counterexample!.original, r.result.counterexample!.candidate)).toBe(false);
    }, 300_000);
  }
});
