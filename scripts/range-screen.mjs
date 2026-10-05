#!/usr/bin/env node
/**
 * Range screen for dataset candidates (docs/PROOFS.md, "Candidate proofs"): looks for a concrete input on which the
 * ORIGINAL stays inside the model's range (its instrumented TypeScript returns or throws an allowed throw) but the
 * CANDIDATE's instrumented TypeScript reports a range violation. Such an input refutes the range part of
 * `candidate_<id>_meets_spec`: no proof can exist. The refuting input is then confirmed in Lean (`Model.f_cand_pre` is
 * false on it). Inputs: the generator under the original's preconditions at several integer scales, plus every integer
 * 0..300 (and negatives) for single-integer functions. "Not refuted" means only that no such input was found.
 *
 *   node scripts/range-screen.mjs [--data docs/measurements/2026-10-05-candidates]
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const root = new URL('..', import.meta.url).pathname;
const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf('--' + n); return i >= 0 ? args[i + 1] : d; };
const data = resolve(root, opt('data', 'docs/measurements/2026-10-05-candidates'));
const imp = (p) => import(pathToFileURL(join(root, p)).href);
const { Sandbox, generateInputs, instrumentedSandboxSource, INSTRUMENTED_ENTRY } = await imp('packages/engine/dist/index.js');
const { translate } = await imp('packages/translate/dist/index.js');
const { translateCandidate } = await imp('packages/cli/dist/flow/candidateProof.js');
const { evalBatch } = await imp('packages/prover/dist/index.js');

const cands = readFileSync(join(data, 'candidates.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
const sb = await Sandbox.open();
const rows = [];
for (const c of cands) {
  const baseEvents = readFileSync(join(data, 'base', c.class, `${c.fn}.events.jsonl`), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l).event);
  const src = baseEvents.find((e) => e.kind === 'session.started').source;
  const t = translate(src, c.fn);
  const ct = translateCandidate(t, c.source);
  const carve = c.theoremExtra.filter((p) => p.kind === 'carve-out');
  const noThrow = c.theoremExtra.some((p) => p.kind === 'no-throw');
  let inputs = [];
  for (const [i, smallInt] of [20, 100, 1000, 100000].entries()) inputs.push(...generateInputs({ params: t.params, preconditions: [...t.preconditions, ...carve] }, { n: 1500, seed: 900 + i, smallInt }).inputs);
  if (t.params.length === 1 && t.params[0].ty.k === 'int') for (let k = -5; k <= 300; k++) inputs.push([k]);
  const seen = new Set();
  inputs = inputs.filter((a) => { const k = JSON.stringify(a); if (seen.has(k)) return false; seen.add(k); return true; });
  const idO = `o:${c.id}`, idC = `c:${c.id}`;
  await sb.load(idO, instrumentedSandboxSource(t), INSTRUMENTED_ENTRY, { instrumented: true });
  const lc = await sb.load(idC, instrumentedSandboxSource({ instrumentedTs: ct.instrumentedTs.replaceAll(`${c.fn}_cand`, c.fn), fnName: c.fn }), INSTRUMENTED_ENTRY, { instrumented: true });
  const o = (await sb.callBatch(idO, inputs, { perCallMs: 200 })).results.map((r) => r.outcome);
  const live = inputs.filter((_, k) => o[k].tag === 'ok' || (o[k].tag === 'throw' && !noThrow));
  const cr = lc.ok ? (await sb.callBatch(idC, live, { perCallMs: 500 })).results.map((r) => r.outcome) : [];
  await sb.unload(idO); await sb.unload(idC);
  const bad = live.filter((_, k) => cr[k]?.tag === 'range-violation');
  let lean = null;
  if (bad.length) {
    // confirm the first refuting input in Lean: the candidate's precondition is false there
    const enc = (v, ty) => ty.k === 'int' ? `(${v} : Int)` : ty.k === 'bool' ? String(v) : ty.k === 'string' ? `${JSON.stringify(v)}.toList` : ty.k === 'array' ? `([${v.map((x) => enc(x, ty.elem)).join(', ')}] : List _)` : null;
    const argText = bad[0].map((v, i) => enc(v, t.params[i].ty));
    if (argText.every((x) => x !== null)) {
      const prelude = ct.lean.source;
      try {
        const r = await evalBatch(prelude, [`Model.${c.fn}_cand_pre ${argText.join(' ')}`], { budgetMs: 120_000 });
        lean = r.outputs[0] ?? (r.errors.get(0) ?? 'no output');
      } catch (e) { lean = 'eval failed: ' + e.message; }
    }
  }
  const row = { id: c.id, inputsTried: inputs.length, originalInRange: live.length, refuted: bad.length > 0, refutingInputs: bad.slice(0, 3), candidateLoaded: lc.ok, leanCandPreOnFirst: lean };
  rows.push(row);
  console.log(`${c.id}: ${row.refuted ? `REFUTED by ${JSON.stringify(bad[0])} (Lean cand_pre: ${JSON.stringify(lean)})` : 'not refuted'} (${live.length} in-range inputs of ${inputs.length})`);
}
await sb.close();
writeFileSync(join(data, 'range-screen.json'), JSON.stringify(rows, null, 2));
process.exit(0);
