// Red-team round 3, area strings-decode: exploration runner (not a test; the vitest file is
// packages/smt/src/redteam-strings-decode.test.ts). Run after `pnpm exec tsc -b`:
//   node packages/smt/redteam/strings-decode/probe.mjs [id-substring ...]
// For every case of cases3.mjs (filtered by the arguments): ground truth over the case's domain in the sandbox
// (both functions range-instrumented), `checkEquivalent` at every listed bound, and sanity mode (the encoding of each
// function evaluated by Z3 on concrete inputs) against the sandbox on a sample of the domain plus `concrete` inputs.
import { Sandbox, outcomeEqual } from '@faithful/engine';
import { translateWithIr } from '@faithful/translate';
import { checkEquivalent, openZ3, runInstrumented } from '../../dist/index.js';
import { concreteMismatches } from './probe-lib.mjs';
import { CASES3 } from './cases3.mjs';

const filters = process.argv.slice(2);
const z3 = await openZ3('system');
const sandbox = await Sandbox.open();

function fn(src) {
  const w = translateWithIr(src, 'f');
  if (!w.result.ok || !w.ir) return { refused: JSON.stringify(w.result).slice(0, 300) };
  return { translation: w.result, ir: w.ir };
}

function sample(xs, n) {
  if (xs.length <= n) return xs;
  const step = Math.ceil(xs.length / n);
  return xs.filter((_, i) => i % step === 0);
}

let probes = 0;
let held = 0;
const bugs = [];
for (const c of CASES3) {
  if (filters.length && !filters.some((f) => c.id.includes(f))) continue;
  probes++;
  const o = fn(c.original);
  const cand = fn(c.candidate);
  if (o.refused || cand.refused) {
    console.log(`REFUSED ${c.id}: ${o.refused ?? cand.refused}`);
    continue;
  }
  const truth = c.truth();
  const [ro, rc] = await runInstrumented([o.translation, cand.translation], truth, { sandbox });
  const diffs = [];
  truth.forEach((x, i) => {
    if (ro[i].tag === 'fault' || ro[i].tag === 'range-violation') return;
    if (!outcomeEqual(ro[i], rc[i])) diffs.push({ x, o: ro[i], c: rc[i] });
  });
  const kindOk = c.kind === 'equal' ? diffs.length === 0 : diffs.length > 0;
  let ok = kindOk;
  const lines = [`truth: ${truth.length} inputs, ${diffs.length} differ${diffs.length ? ` e.g. ${JSON.stringify(diffs[0])}`.slice(0, 300) : ''}${kindOk ? '' : '  <-- LABEL MISMATCH'}`];
  for (const b of c.bounds) {
    const t0 = Date.now();
    const r = await checkEquivalent(o, cand, b, c.budgetMs ?? 120_000, z3, { sandbox });
    const ms = Date.now() - t0;
    let verdict = '';
    if (c.kind === 'equal') verdict = r.status === 'unsat' ? 'held' : r.status === 'sat' ? 'BUG-B?' : 'no-claim';
    else if (c.kind === 'vacuous') verdict = r.status === 'unsat' ? 'BUG-A' : 'held';
    else {
      if (r.status === 'unsat') verdict = 'BUG-A';
      else if (r.status === 'sat') {
        const cx = r.counterexample;
        const pred = JSON.stringify(cx.predicted.original) === JSON.stringify(cx.original) && JSON.stringify(cx.predicted.candidate) === JSON.stringify(cx.candidate);
        verdict = outcomeEqual(cx.original, cx.candidate) ? 'BUG-B(replay agrees)' : pred ? 'held' : 'BUG-B(predicted!=replay)';
      } else verdict = 'no-claim';
    }
    if (verdict !== 'held') ok = false;
    const esc = (x) => JSON.stringify(x).replace(/[^\x20-\x7e]/g, (ch) => `\\u${ch.charCodeAt(0).toString(16).padStart(4, '0')}`);
    lines.push(`  ${JSON.stringify(b)} -> ${r.status} ${ms}ms ${verdict} ${r.reason ?? ''} ${r.bounds.int !== b.int ? `NARROWED int ${r.bounds.int} ` : ''}${r.counterexample ? esc({ in: r.counterexample.input, o: r.counterexample.original, c: r.counterexample.candidate, po: r.counterexample.predicted.original, pc: r.counterexample.predicted.candidate }).slice(0, 400) : ''}`);
  }
  const pts = [...sample(truth, 40), ...(c.concrete ?? [])];
  for (const [nm, f] of [['original', o], ['candidate', cand]]) {
    try {
      const mm = await concreteMismatches(f, pts);
      if (mm.length) {
        ok = false;
        lines.push(`  SANITY ${nm}: ${mm.length} mismatches, e.g. ${JSON.stringify(mm[0]).slice(0, 400)}`);
      }
    } catch (e) {
      lines.push(`  SANITY ${nm}: error ${String(e).slice(0, 200)}`);
    }
  }
  if (ok) held++;
  else bugs.push(c.id);
  console.log(`${ok ? 'HELD ' : 'CHECK'} ${c.id} [${c.kind}]\n${lines.join('\n')}`);
}
console.log(`\nprobes ${probes}, held ${held}, check: ${bugs.join(', ')}`);
await sandbox.close();
process.exit(0);
