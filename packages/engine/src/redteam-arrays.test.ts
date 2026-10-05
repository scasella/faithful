/**
 * Red team, rounds 1 to 4, area "arrays": every file in packages/translate/corpus-redteam/arrays/ is one probe
 * (round-2 probes are the files named `r2*.ts`, round-3 probes `r3*.ts`, round-4 probes `r4*.ts`).
 *
 * Round 3 (2026-10-05): r3ThisParamMap, r3ThisParamFilter, r3ThisParamReduce are confirmed soundness divergences
 * (a `this` parameter on a function-expression callback shifts lower.ts lambda()'s positional parameter binding).
 * They are written as the correct behaviour (refuse) and FAIL until the translator is fixed; they are not it.fails.
 *
 * Round 4 (2026-10-05, files `r4*.ts`): 61 probes, 54 held. Confirmed divergences, all reachable only because a `// @ts-ignore`,
 * `// @ts-expect-error` or file-level `// @ts-nocheck` comment suppresses the TypeScript diagnostic that phase 4 of the
 * translator relies on (the lowering does not repeat the check):
 *   - r4TsIgnoreSortStrMinus, r4TsExpectErrorSortStrMinus, r4TsNocheckSortStrMinus (soundness): `a - b` on string keys
 *     nested in a conditional comparator. lower.ts sort() refuses subtraction on string keys only when the subtraction
 *     is the TOP-LEVEL body expression (`usesMinus`); JS computes NaN (treated as 0, "equal") while the model sorts.
 *   - r4TsIgnoreConstAssign, r4TsIgnoreForOfConstAssign, r4TsIgnoreForConstIndex (soundness): assignment to a `const`
 *     (local, for...of variable, for-loop index). checkAssignable does not look at const-ness; JS throws TypeError, the
 *     model returns a value with pre = true. The harness does not send TypeScript faults to Lean, so these show up
 *     through the explicit-input fault check below ("TypeScript faults where the model's pre holds").
 *   - r4TsIgnoreDupKey (accepted, model does not compile: lean-error): duplicate object-literal key.
 * They are written as the correct behaviour (refuse) and FAIL until the translator is fixed; they are not it.fails.
 * Round 4 also adds an explicit-input check: if the TypeScript original faults on a hand-picked input, the model's `pre`
 * must be false there.
 *
 * Header lines (every line starts with `// @redteam `):
 *   `// @redteam area=arrays status=divergence input=<JSON args> ts=<outcome> lean=<outcome>`  a confirmed divergence
 *   `// @redteam status=held`                                                                  a probe the translator survived
 *   `// @redteam expect=ok` | `// @redteam expect=refuse code=<RefusalCode>[|<RefusalCode>...]` the CORRECT behaviour
 *                                                                                               (alternatives: any listed code is correct)
 *   `// @redteam inputs=<JSON array of argument arrays>`                                        edge cases, run explicitly
 *
 * Expectations are written as the correct behaviour, so a divergence makes its test FAIL until the translator is fixed:
 *   expect=refuse: translate() must refuse with that code, or one of the listed alternatives (an accepted out-of-subset
 *                  function is a soundness bug);
 *   expect=ok:     translate() must accept, and (with Lean) tsVsLean over the explicit inputs plus 150 generated inputs
 *                  must show zero disagreements, and at least one explicit input must actually be compared (inside rangeOk).
 *   Any probe the translator accepts (including a wrongly accepted expect=refuse probe) also gets the tsVsLean check, so a
 *   wrong acceptance shows its concrete TS-vs-Lean divergence in the failure message.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveLeanDir } from '@faithful/core';
import { leanEvalExpr, leanPredicateExpr, listExportedFunctions, parseLeanOutcome, translate, type Val } from '@faithful/translate';
import { Sandbox } from './sandbox/sandbox.js';
import { tsVsLean, type LeanEvaluator } from './differential/differential.js';

const hasLean = !process.env.FAITHFUL_SKIP_LEAN && resolveLeanDir() !== null;
const here = dirname(fileURLToPath(import.meta.url));
const DIR = join(here, '../../translate/corpus-redteam/arrays');

interface Probe {
  name: string;
  source: string;
  fnName: string;
  status: 'held' | 'divergence';
  expect: 'ok' | 'refuse';
  code?: string;
  inputs: Val[][];
}

function load(): Probe[] {
  const out: Probe[] = [];
  for (const f of readdirSync(DIR).filter((x) => x.endsWith('.ts')).sort()) {
    const source = readFileSync(join(DIR, f), 'utf8');
    let status: Probe['status'] | undefined;
    let exp: Probe['expect'] | undefined;
    let code: string | undefined;
    let inputs: Val[][] = [];
    for (const line of source.split('\n')) {
      const m = /^\/\/ @redteam (.*)$/.exec(line.trimEnd());
      if (!m) continue;
      const body = m[1]!;
      if (/(^|\s)status=held(\s|$)/.test(body)) status = 'held';
      else if (/(^|\s)status=divergence(\s|$)/.test(body)) status = 'divergence';
      const e = /^expect=(ok|refuse)(?: code=(\S+))?$/.exec(body);
      if (e) {
        exp = e[1] as Probe['expect'];
        code = e[2];
      }
      if (body.startsWith('inputs=')) inputs = JSON.parse(body.slice('inputs='.length)) as Val[][];
    }
    if (!status || !exp) throw new Error(`${f}: missing status or expect header`);
    const fnName = listExportedFunctions(source).find((x) => x.exported)?.name;
    if (!fnName) throw new Error(`${f}: no exported function`);
    out.push({ name: f.replace(/\.ts$/, ''), source, fnName, status, expect: exp, code, inputs });
  }
  return out;
}

const probes = load();

async function leanEvaluator(): Promise<LeanEvaluator> {
  const { evalBatch } = await import('../../prover/src/lean.js');
  return { evalBatch: (prelude, exprs, opts) => evalBatch(prelude, exprs, opts) };
}

describe('redteam arrays: probe inventory', () => {
  it('has at least 25 probes', () => {
    expect(probes.length).toBeGreaterThanOrEqual(25);
  });
});

describe('redteam arrays: acceptance / refusal', () => {
  for (const p of probes) {
    it(`${p.name} [${p.status}]: ${p.expect}${p.code ? ' ' + p.code : ''}`, () => {
      const r = translate(p.source, p.fnName);
      if (process.env.REDTEAM_VERBOSE) console.log(p.name, r.ok ? 'ACCEPTED' : `${r.refusal.code} @${r.refusal.span.line}:${r.refusal.span.column}: ${r.refusal.reason}`);
      if (p.expect === 'refuse') {
        const allowed = (p.code ?? '').split('|');
        const got = r.ok ? 'ACCEPTED' : r.refusal.code;
        expect(allowed.includes(got) ? p.code : got, `${p.name}: allowed ${p.code}`).toBe(p.code);
      }
      else expect(r.ok ? 'ok' : `refused ${r.refusal.code}: ${r.refusal.reason}`).toBe('ok');
    });
  }
});

describe.skipIf(!hasLean)('redteam arrays: tsVsLean (real Lean)', () => {
  let sb: Sandbox;
  let lean: LeanEvaluator;
  beforeAll(async () => {
    sb = await Sandbox.open({ defaultTimeoutMs: 1000, memoryMb: 1024 });
    lean = await leanEvaluator();
  });
  afterAll(async () => {
    await sb.close();
  });
  // expect=ok probes, and expect=refuse probes that the translator (wrongly) accepts: the accepted model must agree with
  // TypeScript. For a wrongly accepted probe this shows the concrete unsoundness, not just the acceptance.
  for (const p of probes.filter((x) => x.expect === 'ok' || translate(x.source, x.fnName).ok)) {
    it(
      `${p.name} [${p.status}]: zero disagreements`,
      async () => {
        const t = translate(p.source, p.fnName);
        expect(t.ok).toBe(true);
        if (!t.ok) return;
        const fmt = (ds: Array<{ kind: string; args: Val[]; ts: unknown; lean?: unknown; predicates?: unknown; detail: string }>) =>
          JSON.stringify(ds.slice(0, 3).map((d) => ({ kind: d.kind, args: d.args, ts: d.ts, lean: d.lean, predicates: d.predicates, detail: d.detail })));
        if (p.inputs.length > 0) {
          const ex = await tsVsLean(t, { n: p.inputs.length, seed: 1, inputs: p.inputs }, { lean, sandbox: sb });
          if (process.env.REDTEAM_VERBOSE) console.log(p.name, 'explicit', JSON.stringify({ compared: ex.compared, agree: ex.agreements, excl: ex.rangeExcluded, faults: ex.tsFaults, rej: ex.rejectedByPrecondition }));
          expect(ex.disagreements.length, `${p.name} explicit: ${fmt(ex.disagreements)}`).toBe(0);
          // Round 4: the harness does not send an input on which the TypeScript side faults to Lean (a fault decides
          // nothing). For the hand-picked explicit inputs a fault must still be excluded by the model's precondition:
          // `pre = true` there means the model claims a value where JavaScript throws (e.g. TypeError).
          if (ex.tsFaultSamples.length > 0) {
            const exprs = ex.tsFaultSamples.map((s) => `(do ${leanPredicateExpr(t, 'pre', s.args)}; ${leanEvalExpr(t, s.args)})`);
            const res = await lean.evalBatch(t.lean.source, exprs, { budgetMs: 120_000 });
            const claims = ex.tsFaultSamples
              .map((s, i) => ({ args: s.args, ts: s.outcome, lean: (res.outputs[i] ?? res.errors.get(i) ?? '').split('\n') }))
              .filter((c) => c.lean[0] === 'true')
              .map((c) => ({ args: c.args, ts: c.ts, pre: 'true', lean: parseLeanOutcome(c.lean[1]) }));
            expect(claims.length, `${p.name}: TypeScript faults where the model's pre holds: ${JSON.stringify(claims.slice(0, 3))}`).toBe(0);
          }
          expect(ex.compared, `${p.name}: no explicit input was compared`).toBeGreaterThan(0);
        }
        const gen = await tsVsLean(t, { n: 150, seed: 20261005 }, { lean, sandbox: sb });
        if (process.env.REDTEAM_VERBOSE) console.log(p.name, 'generated', JSON.stringify({ compared: gen.compared, agree: gen.agreements, excl: gen.rangeExcluded, faults: gen.tsFaults }));
        expect(gen.disagreements.length, `${p.name} generated: ${fmt(gen.disagreements)}`).toBe(0);
      },
      300_000,
    );
  }
});
