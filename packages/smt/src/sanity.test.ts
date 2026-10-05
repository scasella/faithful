/**
 * Sanity mode over the whole translator corpus: the SMT encoding of every in-subset function, evaluated by Z3 on
 * generated inputs, must equal the range-instrumented TypeScript original (and the Lean checked twin when Lean is
 * available). Any mismatch is an encoder bug.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveLeanDir } from '@faithful/core';
import { Sandbox, liveSandboxWorkers, loadCorpus, type LeanEvaluator } from '@faithful/engine';
import { translateWithIr } from '@faithful/translate';
import { sanityCheck, type SanityReport } from './sanity.js';
import { openZ3, type Z3Driver } from './z3.js';

const here = dirname(fileURLToPath(import.meta.url));
const CORPUS = join(here, '../../translate/corpus');
const hasLean = !process.env.FAITHFUL_SKIP_LEAN && resolveLeanDir() !== null;
const N = 60;

const entries = loadCorpus(CORPUS)
  .map((e) => ({ e, w: translateWithIr(e.source, e.fnName) }))
  .filter((x) => x.w.result.ok && x.w.ir);

let z3: Z3Driver;
let sandbox: Sandbox;
let lean: LeanEvaluator | undefined;
const reports = new Map<string, SanityReport>();

beforeAll(async () => {
  z3 = await openZ3('system'); // system first: the corpus run is many large scripts (WASM is exercised in equivalence.test.ts)
  sandbox = await Sandbox.open();
  if (hasLean) {
    const { evalBatch } = await import('../../prover/src/lean.js');
    lean = { evalBatch: (prelude, exprs, opts) => evalBatch(prelude, exprs, opts) };
  }
});

afterAll(async () => {
  await sandbox?.close();
  expect(liveSandboxWorkers()).toBe(0);
  const rs = [...reports.entries()];
  const sum = (f: (r: SanityReport) => number): number => rs.reduce((a, [, r]) => a + f(r), 0);
  const lines = rs.map(
    ([id, r]) =>
      `${id}: inputs ${r.inputs}, compared ${r.compared} (ok ${r.tags.ok} / throw ${r.tags.throw} / range-violation ${r.tags['range-violation']}), ` +
      `fuel ${r.fuel}, ts faults ${r.tsFaults}, solver missing ${r.solverMissing}, unique ${r.uniquenessChecked}, lean ${r.leanCompared}, ` +
      `mismatches ${r.mismatches.length}, U=${r.unroll}, bounds a${r.bounds.array}/s${r.bounds.string}, smt ${(r.smtChars / 1e6).toFixed(2)}MB, ` +
      `solve ${Math.round(r.solveMs)}ms, total ${Math.round(r.ms)}ms${r.encodable ? '' : ` UNSUPPORTED ${r.unsupported.join('; ')}`}`,
  );
  console.log(
    [
      `SMT sanity (${new Date().toISOString()}, z3 ${z3.kind} ${z3.version}, Node ${process.version}): ${rs.length} functions, ` +
        `${rs.filter(([, r]) => r.encodable).length} encodable, inputs ${sum((r) => r.inputs)}, compared ${sum((r) => r.compared)}, ` +
        `agreements ${sum((r) => r.agreements)}, fuel ${sum((r) => r.fuel)}, ts faults ${sum((r) => r.tsFaults)}, ` +
        `uniqueness checks ${sum((r) => r.uniquenessChecked)}, lean compared ${sum((r) => r.leanCompared)}, mismatches ${sum((r) => r.mismatches.length)}`,
      ...lines,
    ].join('\n'),
  );
});

describe('SMT sanity mode over the corpus', () => {
  it('covers every in-subset corpus function', () => {
    expect(entries.length).toBe(39);
  });

  it.each(entries.map((x) => [x.e.id, x] as const))('%s: encoder = instrumented original on generated inputs', async (id, x) => {
    if (!x.w.result.ok || !x.w.ir) throw new Error('unreachable');
    const r = await sanityCheck(x.w.result, x.w.ir, z3, { n: N, sandbox, lean });
    reports.set(id, r);
    expect(r.mismatches).toEqual([]);
    expect(r.inputs).toBeGreaterThanOrEqual(50);
    if (r.encodable) {
      // every input is accounted for, and the comparison is not vacuous
      expect(r.compared + r.fuel + r.tsFaults + r.solverMissing).toBe(r.inputs);
      expect(r.solverMissing).toBe(0);
      expect(r.uniquenessChecked).toBe(r.inputs - r.solverMissing);
      expect(r.compared).toBeGreaterThanOrEqual(25);
    }
  }, 600_000);
});
