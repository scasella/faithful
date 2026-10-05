// Red team round 3, arith-control: mutation fuzzing. Each seed (arith/control heavy) against engine mutants, at small
// bounds; ground truth by exhaustive sandbox enumeration; the encoder also evaluated on concrete inputs (sanity).
//   node packages/smt/redteam/arith-control/fuzz-r3.mjs [maxMutantsPerSeed]
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Sandbox, generateMutants, outcomeEqual } from '@faithful/engine';
import { checkEquivalent, openSystemZ3, runInstrumented } from '../../dist/index.js';
import { fnut, enumerate, truthDiffs, encEval, maxAbs } from './harness.mjs';

export const SEEDS = JSON.parse(readFileSync(new URL('./fuzz-seeds.json', import.meta.url), 'utf8')).map((x) => [x.name, x.bounds, x.source]);

async function main() {
  const max = Number(process.argv[2] ?? 12);
  const z3 = await openSystemZ3();
  const sandbox = await Sandbox.open();
  let probes = 0;
  const bad = [];
  const tally = {};
  try {
    for (const [name, b, src] of SEEDS) {
      const o = fnut(src, 'f');
      if (o.refused) { console.log(name, 'SEED REFUSED', o.refused); continue; }
      const { mutants } = generateMutants(src, 'f', { seed: 3, max });
      const inputs = enumerate(o.translation, {}, b);
      const [oo] = await runInstrumented([o.translation], inputs, { sandbox });
      const eo = await encEval(o, inputs.slice(0, 400), b, b.unroll, z3);
      eo.forEach((e, i) => {
        if (e.tag !== 'fuel' && oo[i].tag !== 'fault' && !outcomeEqual(e, oo[i])) bad.push({ name, kind: 'SANITY-orig', input: inputs[i], enc: e, ts: oo[i] });
      });
      for (const m of [{ id: 'self', source: src }, ...mutants]) {
        const c = fnut(m.source, 'f');
        if (c.refused) continue;
        probes++;
        const r = await checkEquivalent(o, c, b, 60_000, z3, { sandbox });
        const [co] = await runInstrumented([c.translation], inputs, { sandbox });
        const all = truthDiffs(inputs, oo, co);
        const box = r.status === 'unsat' ? r.bounds.int : b.int;
        const diffs = all.filter((d) => maxAbs(d.input) <= box);
        tally[r.status] = (tally[r.status] ?? 0) + 1;
        let v = 'held';
        if (r.status === 'unsat' && diffs.length) v = 'BUG-A';
        else if (r.status === 'inconclusive') v = 'BUG-B-inconclusive';
        else if (r.status === 'sat' && !all.some((d) => JSON.stringify(d.input) === JSON.stringify(r.counterexample.input))) v = 'CHECK-witness';
        else if (r.status !== 'sat' && r.status !== 'unsat') v = 'OTHER-' + r.status;
        const ec = await encEval(c, inputs.slice(0, 400), b, b.unroll, z3);
        const sm = [];
        ec.forEach((e, i) => { if (e.tag !== 'fuel' && co[i].tag !== 'fault' && !outcomeEqual(e, co[i])) sm.push({ input: inputs[i], enc: e, ts: co[i] }); });
        if (sm.length) v += ` SANITY(${sm.length})`;
        if (v !== 'held') bad.push({ name, mutant: m.id, mutated: `${m.original} -> ${m.mutated}`, status: r.status, reason: r.reason, coverage: r.coverage, cex: r.counterexample?.input, firstDiff: diffs[0], sanity: sm[0], v });
        console.log(name, m.id, `${m.original ?? ''}->${m.mutated ?? ''}`, r.status, r.coverage?.kind ?? '', r.bounds.int, `truth ${diffs.length}/${all.length}`, v);
      }
    }
  } finally {
    await sandbox.close();
  }
  console.log(`\n${probes} probes`, JSON.stringify(tally));
  for (const x of bad) console.log(JSON.stringify(x));
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) await main();
