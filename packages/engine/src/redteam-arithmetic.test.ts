/**
 * Red team, round 1, area "arithmetic" (integer semantics, %, Math.floor/ceil division, abs/min/max, ±2^53 bounds,
 * rangeOk vs instrumentedTs agreement, comparisons/booleans/ternary, number formatting in strings, int-bound).
 *
 * Cases live in packages/translate/corpus-redteam/arithmetic/*.ts, one exported function per file, with a header
 *   // @redteam area=arithmetic status=held|divergence [input=<JSON args>] [ts=..] [lean=..] expect=ok|refuse|range-violation [code=<RefusalCode>]
 *   // @inputs <JSON array of argument lists>          (held, expect=ok only)
 *
 *  - status=held expect=refuse: translate() must refuse with exactly `code`.
 *  - status=held expect=ok: translate() accepts; on every listed input the instrumented runner agrees with the plain
 *    original whenever it reports no violation (Lean-free); with Lean, tsVsLean on the listed inputs plus 60 generated
 *    ones shows zero disagreements.
 *  - status=divergence: written as the CORRECT behaviour, so these tests FAIL until the translator is fixed:
 *      expect=range-violation: the instrumented original must report `range-violation` on `input` (Lean-free), and
 *        with Lean tsVsLean on [input] must show zero disagreements (today: `range-ok` + `outcome` disagreements);
 *      expect=refuse: translate() must refuse with `code`.
 *    They are deliberately NOT marked it.fails.
 *
 * Round 2 (header token `round=2`, 2026-10-05) adds optional lines:
 *   // @tags <JSON array of Outcome tags>   aligned with @inputs: the instrumented original's tag on each input
 *                                           (pins that boundary inputs really hit, or stay inside, the bound);
 *   // @excluded <JSON array of arg lists>  inputs the `ts` preconditions (int-bound) must reject;
 *   `code=a|b` on a refusal: either code is accepted.
 *  Round-2 divergences (moduleMathShadow, mathFloorPatched, mathAbsPatched; FAIL until fixed, not it.fails): a module-level
 *  binding named `Math`, or a top-level statement that reassigns `Math.floor`/`Math.abs`, is ignored by translate()
 *  (the builtin model is used) and by tsVsLean (plainTs omits the statement), while the real module computes 3.5 / -5.
 *  and, with Lean, every listed input must be accounted for: compared or range-excluded (none dropped as a TS fault,
 *  as too costly, or silently by a precondition). Round-2 families: loop counters at +-2^53 (where plain JS gets stuck
 *  because 2^53 + 1 rounds to 2^53), products at the inclusive bound, fdiv/cdiv/tmod at +-2^53 through real Lean,
 *  literal-union divisors of Math.floor/ceil, checked divisions in loop bounds and nested inside each other,
 *  hex/binary/octal/separator literals in measures, intToStr at the bound, int-bound on arrays of records,
 *  literal-union types at +-2^53, boolean algebra, and refusals of non-terminating ceil/identity halving.
 *
 * Round 3 (header token `round=3`, 2026-10-05): the round-2 accounting (every listed input compared or range-excluded,
 * none rejected by a precondition, none a TS fault) applies too, plus a Lean-free check that the compiled `ts`
 * preconditions accept every listed input and reject every @excluded one. Families: evaluation order of a range
 * violation vs a throwing self-call (record fields written out of declared order, tuple/array/template/Math.max
 * operands, compound assignment, dividend/divisor throws vs a zero divisor, self-call arguments), a checked product in
 * a loop bound, Int (not Nat) length arithmetic, negative literals in application positions, string += number/boolean,
 * checks inside reduce/filter callbacks, literal-union narrowing, integer-valued exponent literals, and refusals of
 * String()/Number()/parseInt/Math.imul/sign/clz32/trunc, ToString of arrays/tuples, divisions hidden from the floor
 * pattern by unary minus / casts / satisfies / conditionals.
 * Round-3 divergences (FAIL until fixed, not it.fails): r3ParamMath, r3ParamNumber (the int-bound `ts` expression uses
 * the globals Math/Number by name and is evaluated with the parameters in scope); r3RunnerNameRun/Value/Input
 * (buildInstrumentedRunner's own bindings `run`, `value`, `input` capture a function of that name); r3FnNameRangeClass
 * (the sandbox runtime's `extends FaithfulRangeViolation` resolves to a user function of that name, so range
 * violations become TS faults and are never cross-checked against Lean's rangeOk).
 *
 * Round 4 (header token `round=4`, 2026-10-05): the round-2/3 accounting and the Lean-free precondition check apply,
 * plus, with Lean, every accepted round-4 probe's model must also compile with `import Faithful.Tactics` in place of
 * `import Faithful.Core` (what a theorem file does). Families: checked operations in loop conditions on the exiting
 * evaluation, before break/continue, in returns from loops, in a recursion guard's second disjunct and in ternary
 * conditions; -0 (from `a * 0`, `Math.ceil`, `%`) being unobservable, including as a divisor; nested `%` sign chains;
 * ceil/floor cross-sign identities at +-2^53; fractional literal text with an integer double value; int-bound on
 * records with non-identifier field names; parameters named NaN/Infinity/omega/simp/...; comparator keys that index
 * arrays/strings and join on nested arrays (refused); extreme literals in measure positions (refused, no crash).
 * Round-4 divergences (completeness, FAIL until fixed, not it.fails): r4TokParam, r4TokLocal, r4TokField,
 * r4TokFnName (a parameter / local / record field / the function itself named with a builtin Lean token such as
 * `using`, `until`, `matches`, `repeat`: LEAN_RESERVED misses them, the model does not parse, every comparison is a
 * lean-error) and r4TokTacticsTo (`to` is a Mathlib token: the model evaluates under Faithful.Core, but the theorem
 * file with Faithful.Tactics does not parse; header `lean=tactics-error`).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { resolveLeanDir } from '@faithful/core';
import { buildInstrumentedRunner, translate, type Outcome, type Translation, type Val } from '@faithful/translate';
import { Sandbox, liveSandboxWorkers } from './sandbox/sandbox.js';
import { tsVsLean, valEqual, type LeanEvaluator } from './differential/differential.js';
import { compilePreconditions } from './differential/generate.js';

const hasLean = !process.env.FAITHFUL_SKIP_LEAN && resolveLeanDir() !== null;
const here = dirname(fileURLToPath(import.meta.url));
const DIR = join(here, '../../translate/corpus-redteam/arithmetic');

interface Case {
  file: string;
  fnName: string;
  source: string;
  h: Record<string, string>;
  inputs: Val[][];
  tags?: string[];
  excluded?: Val[][];
}

function loadCases(): Case[] {
  const out: Case[] = [];
  for (const file of readdirSync(DIR).filter((f) => f.endsWith('.ts')).sort()) {
    const source = readFileSync(join(DIR, file), 'utf8');
    const lines = source.split('\n');
    const head = lines[0]!;
    if (!head.startsWith('// @redteam ')) throw new Error(`${file}: missing // @redteam header`);
    const h: Record<string, string> = {};
    for (const tok of head.slice('// @redteam '.length).trim().split(/\s+/)) {
      const i = tok.indexOf('=');
      if (i > 0) h[tok.slice(0, i)] = tok.slice(i + 1);
    }
    const inp = lines.find((l) => l.startsWith('// @inputs '));
    const inputs: Val[][] = inp ? (JSON.parse(inp.slice('// @inputs '.length)) as Val[][]) : h.input ? [JSON.parse(h.input) as Val[]] : [];
    const m = /export function (\w+)/.exec(source);
    if (!m) throw new Error(`${file}: no exported function`);
    const tg = lines.find((l) => l.startsWith('// @tags '));
    const ex = lines.find((l) => l.startsWith('// @excluded '));
    const tags = tg ? (JSON.parse(tg.slice('// @tags '.length)) as string[]) : undefined;
    const excluded = ex ? (JSON.parse(ex.slice('// @excluded '.length)) as Val[][]) : undefined;
    out.push({ file, fnName: m[1]!, source, h, inputs, tags, excluded });
  }
  return out;
}

const cases = loadCases();

function runner(t: Translation): (args: Val[]) => Outcome {
  return new Function('return ' + buildInstrumentedRunner(t))() as (args: Val[]) => Outcome;
}

function plain(c: Case): (...args: Val[]) => unknown {
  const js = ts.transpileModule(c.source.replace(/^export /m, ''), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  return new Function(`${js}\nreturn ${c.fnName};`)() as (...args: Val[]) => unknown;
}

async function leanEvaluator(): Promise<LeanEvaluator> {
  const { evalBatch } = await import('../../prover/src/lean.js');
  return { evalBatch: (prelude, exprs, opts) => evalBatch(prelude, exprs, opts) };
}

describe('redteam arithmetic: corpus shape', () => {
  it('has at least 25 distinct probes, every header well-formed', () => {
    expect(cases.length).toBeGreaterThanOrEqual(25);
    for (const c of cases) {
      expect(c.h.area, c.file).toBe('arithmetic');
      expect(['held', 'divergence'], c.file).toContain(c.h.status);
      expect(['ok', 'refuse', 'range-violation'], c.file).toContain(c.h.expect);
      if (c.h.expect === 'refuse') expect(c.h.code, c.file).toBeTruthy();
      if (c.h.status === 'divergence') expect([c.h.input, c.h.ts, c.h.lean].every(Boolean), c.file).toBe(true);
      if (c.h.expect !== 'refuse') expect(c.inputs.length, c.file).toBeGreaterThan(0);
      if (c.tags) expect(c.tags.length, c.file).toBe(c.inputs.length);
    }
  });
  it('round 2 adds at least 25 new probes', () => {
    expect(cases.filter((c) => c.h.round === '2').length).toBeGreaterThanOrEqual(25);
  });
  it('round 3 adds at least 25 new probes', () => {
    expect(cases.filter((c) => c.h.round === '3').length).toBeGreaterThanOrEqual(25);
  });
  it('round 4 adds at least 25 new probes', () => {
    expect(cases.filter((c) => c.h.round === '4').length).toBeGreaterThanOrEqual(25);
  });
});

describe('redteam arithmetic: translate() and the instrumented original (no Lean)', () => {
  for (const c of cases) {
    it(`${c.file}: ${c.h.status} expect=${c.h.expect}${c.h.code ? ' ' + c.h.code : ''}${c.h.round ? ' round' + c.h.round : ''}`, () => {
      const r = translate(c.source, c.fnName);
      if (c.h.expect === 'refuse') {
        // `code=a|b`: either code is a correct refusal (round 2, where the right code is the fixer's choice)
        expect(c.h.code!.split('|'), `${c.file} must be refused (got ${r.ok ? 'accepted' : r.refusal.code})`).toContain(r.ok ? 'accepted' : r.refusal.code);
        return;
      }
      expect(r.ok ? 'ok' : `refused ${r.refusal.code}: ${r.refusal.reason}`).toBe('ok');
      if (!r.ok) return;
      const run = runner(r);
      if (c.h.expect === 'range-violation') {
        for (const a of c.inputs) {
          const o = run(a);
          expect(o.tag, `${c.file} ${JSON.stringify(a)}: instrumented original returned ${JSON.stringify(o)}; the Lean rangeOk is false here`).toBe('range-violation');
        }
        return;
      }
      if (c.h.round === '3' || c.h.round === '4') {
        // round 3: the `ts` preconditions (int-bound, bmp) must accept every listed input and reject every @excluded one,
        // exactly as the Lean `pre` does (r3ParamMath / r3ParamNumber: the ts expression is not hygienic)
        const preds = compilePreconditions(r.params, r.preconditions);
        for (const a of c.inputs) expect(preds.filter((p) => !p.test(a)).map((p) => p.id), `${c.file} ${JSON.stringify(a)}: rejected by the ts precondition`).toEqual([]);
        for (const a of c.excluded ?? []) expect(preds.some((p) => !p.test(a)), `${c.file} ${JSON.stringify(a)}: must be rejected`).toBe(true);
      }
      const f = plain(c);
      c.inputs.forEach((a, k) => {
        if (c.tags) expect(run(a).tag, `${c.file} ${JSON.stringify(a)}: instrumented outcome tag`).toBe(c.tags[k]);
      });
      for (const a of c.inputs) {
        const o = run(a);
        if (o.tag === 'range-violation') continue;
        expect(o.tag, `${c.file} ${JSON.stringify(a)}: ${JSON.stringify(o)}`).not.toBe('fault');
        let p: Outcome;
        try {
          const v = f(...(JSON.parse(JSON.stringify(a)) as Val[]));
          p = { tag: 'ok', value: v === undefined ? null : (JSON.parse(JSON.stringify(v)) as Val) };
        } catch (e) {
          p = { tag: 'throw', message: (e as Error).message };
        }
        expect(p.tag, `${c.file} ${JSON.stringify(a)}`).toBe(o.tag);
        if (p.tag === 'ok' && o.tag === 'ok') expect(valEqual(p.value, o.value), `${c.file} ${JSON.stringify(a)}: plain ${JSON.stringify(p.value)} vs instrumented ${JSON.stringify(o.value)}`).toBe(true);
      }
    });
  }
});

describe.skipIf(!hasLean)('redteam arithmetic: tsVsLean (real Lean)', () => {
  let sb: Sandbox;
  let lean: LeanEvaluator;
  beforeAll(async () => {
    sb = await Sandbox.open({ defaultTimeoutMs: 1000, memoryMb: 1024 });
    lean = await leanEvaluator();
  });
  afterAll(async () => {
    await sb.close();
    expect(liveSandboxWorkers()).toBe(0);
  });
  for (const c of cases.filter((x) => x.h.expect !== 'refuse')) {
    it(
      `${c.file}: zero disagreements on the listed inputs${c.h.status === 'held' ? ' and 60 generated ones' : ''}${c.h.round ? ' round' + c.h.round : ''}`,
      async () => {
        const r = translate(c.source, c.fnName);
        expect(r.ok).toBe(true);
        if (!r.ok) return;
        const explicit = await tsVsLean(r, { n: 0, seed: 1, inputs: c.inputs, perCallMs: 1000 }, { lean, sandbox: sb });
        expect(explicit.disagreements.map((d) => `${d.kind} ${JSON.stringify(d.args)}: ${d.detail}`)).toEqual([]);
        expect(explicit.excludedAccepted).toEqual([]);
        if (c.h.round === '4') {
          // round 4: a theorem file replaces `import Faithful.Core` with `import Faithful.Tactics` (NOTES "Lean output
          // conventions"); the model must still parse and elaborate there (r4TokTacticsTo: `to` is a Mathlib token)
          const { checkLean } = await import('../../prover/src/lean.js');
          const src = r.lean.source.replace(/^import Faithful\.Core$/m, 'import Faithful.Tactics');
          const chk = await checkLean({ source: src, budgetMs: 120_000 });
          expect(chk.diagnostics.filter((d) => d.severity === 'error').map((d) => `${d.line}:${d.column} ${d.message}`), `${c.file}: model under Faithful.Tactics`).toEqual([]);
          expect(chk.ok).toBe(true);
        }
        if (c.h.round === '2' || c.h.round === '3' || c.h.round === '4') {
          // every listed input is accounted for: compared with Lean, or a range violation on both sides
          expect({ underPre: explicit.underPreconditions, faults: explicit.tsFaultSamples, costly: explicit.tooCostly }).toEqual({ underPre: c.inputs.length, faults: [], costly: 0 });
          expect(explicit.compared + explicit.rangeExcluded).toBe(c.inputs.length);
          if (c.excluded) {
            const ex = await tsVsLean(r, { n: 0, seed: 1, inputs: c.excluded, perCallMs: 1000 }, { lean, sandbox: sb });
            expect(ex.underPreconditions, `${c.file}: the int-bound precondition must reject ${JSON.stringify(c.excluded)}`).toBe(0);
          }
        }
        if (c.h.status === 'held') {
          const gen = await tsVsLean(r, { n: 60, seed: 20261005, perCallMs: 1000 }, { lean, sandbox: sb });
          expect(gen.disagreements.map((d) => `${d.kind} ${JSON.stringify(d.args)}: ${d.detail}`)).toEqual([]);
        }
      },
      300_000,
    );
  }
});
