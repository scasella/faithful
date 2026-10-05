// Red team round 1, area arith-control: exploration harness (not a test; the vitest file is
// packages/smt/src/redteam-arith-control.test.ts). Run after `pnpm exec tsc -b`:
//   node packages/smt/redteam/arith-control/harness.mjs [name-filter]
// For every *.case file here: translate both functions, run checkEquivalent at every listed bound, compute ground truth
// by running BOTH instrumented functions in the sandbox over every input of the case's domain (exhaustive for small
// bounds), and evaluate the encoder on those same concrete inputs (sanity mode on adversarial inputs).
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Sandbox, outcomeEqual } from '@faithful/engine';
import { translateWithIr } from '@faithful/translate';
import { checkEquivalent, openSystemZ3, runInstrumented, Encoder, declareInput, Smt } from '../../dist/index.js';
import { outcomeTerms, lookup, decodeOutcome } from '../../dist/outcome.js';
import { readAnswers, transcript } from '../../dist/sexpr.js';
import { and, eq } from '../../dist/terms.js';
import { eqConst } from '../../dist/values.js';

const here = dirname(fileURLToPath(import.meta.url));

export function parseCase(text, name) {
  const head = {};
  for (const m of text.matchAll(/^\/\/ @(\w+) (.*)$/gm)) head[m[1]] = m[2].trim();
  const [, o, c] = text.split(/^\/\/ -{3,} (?:original|candidate)\s*$/m);
  return {
    name,
    fn: head.fn ?? 'f',
    expect: head.expect, // 'diff' | 'equal' | 'equal-within-U'
    bounds: JSON.parse(head.bounds),
    domain: head.domain ? JSON.parse(head.domain) : null,
    inputs: head.inputs ? JSON.parse(head.inputs) : null,
    note: head.note ?? '',
    original: o.trim(),
    candidate: c.trim(),
  };
}

export function loadCases(dir = here) {
  return readdirSync(dir)
    .filter((f) => f.endsWith('.case'))
    .sort()
    .map((f) => parseCase(readFileSync(join(dir, f), 'utf8'), f.replace(/\.case$/, '')));
}

export function fnut(src, name) {
  const w = translateWithIr(src, name);
  if (!w.result.ok || !w.ir) return { refused: JSON.stringify(w.result).slice(0, 300) };
  return { translation: w.result, ir: w.ir };
}

function valuesOf(ty, d, b) {
  switch (ty.k) {
    case 'int': {
      if (d.ints) return d.ints.filter((x) => Math.abs(x) <= b.int);
      const out = [];
      for (let i = -b.int; i <= b.int; i++) out.push(i);
      return out;
    }
    case 'bool':
      return [false, true];
    case 'string': {
      const alpha = d.alpha ?? ['a', 'b'];
      const out = [''];
      let layer = [''];
      for (let n = 1; n <= b.string; n++) {
        layer = layer.flatMap((s) => alpha.map((c) => s + c));
        out.push(...layer);
      }
      return out;
    }
    case 'array': {
      const el = d.elems ?? valuesOf(ty.elem, d, b);
      const out = [[]];
      let layer = [[]];
      for (let n = 1; n <= b.array; n++) {
        layer = layer.flatMap((xs) => el.map((x) => [...xs, x]));
        out.push(...layer);
      }
      return out;
    }
    case 'tuple': {
      let acc = [[]];
      for (const e of ty.elems) {
        const vs = valuesOf(e, d, b);
        acc = acc.flatMap((a) => vs.map((v) => [...a, v]));
      }
      return acc;
    }
    case 'record': {
      let acc = [{}];
      for (const fl of ty.fields) {
        const vs = valuesOf(fl.ty, d, b);
        acc = acc.flatMap((a) => vs.map((v) => ({ ...a, [fl.name]: v })));
      }
      return acc;
    }
    default:
      throw new Error(`domain: ${ty.k}`);
  }
}

/** Every input of the domain within bounds b (cartesian product over parameters). */
export function maxAbs(v) {
  if (typeof v === 'number') return Math.abs(v);
  if (Array.isArray(v)) return v.reduce((m, x) => Math.max(m, maxAbs(x)), 0);
  if (v && typeof v === 'object') return Object.values(v).reduce((m, x) => Math.max(m, maxAbs(x)), 0);
  return 0;
}

export function enumerate(t, d, b) {
  let acc = [[]];
  for (const p of t.params) {
    const vs = valuesOf(p.ty, d, b);
    acc = acc.flatMap((a) => vs.map((v) => [...a, v]));
  }
  return acc;
}

/** Ground truth: inputs where the original is in the model (ok/throw) and the replayed outcomes differ. */
export function truthDiffs(inputs, oo, co) {
  const out = [];
  inputs.forEach((x, i) => {
    const o = oo[i];
    const c = co[i];
    if (o.tag !== 'ok' && o.tag !== 'throw') return;
    if (c.tag === 'fault') return;
    if (!outcomeEqual(o, c)) out.push({ input: x, original: o, candidate: c });
  });
  return out;
}

/** The encoder evaluated on concrete inputs (as sanity mode does): one (reset) block per input. */
export async function encEval(f, inputs, b, unroll, z3) {
  const params = f.translation.params.map((p) => p.ty);
  const smt = new Smt({ maxChars: 20_000_000 });
  smt.emit('(set-option :produce-models true)');
  const shared = { msgs: [] };
  const ins = params.map((ty, i) => declareInput(smt, ty, b, `in${i}`));
  for (const x of ins) smt.assert(x.dom);
  const enc = new Encoder(smt, f.ir, { unroll, shared });
  const out = enc.run(ins.map((x) => x.v));
  const base = smt.text();
  const terms = outcomeTerms(out);
  const res = [];
  const chunk = 40;
  for (let s = 0; s < inputs.length; s += chunk) {
    const part = inputs.slice(s, s + chunk);
    const script = part
      .map((args) => `(reset)\n${base}\n(assert ${and(...args.map((a, i) => eqConst(ins[i].v, a, params[i])))})\n(check-sat)\n(get-value (${terms.join(' ')}))`)
      .join('\n');
    const r = await z3.solve(script, { timeoutMs: 120_000 });
    const { answers, errors } = readAnswers(transcript(r));
    if (errors.length) throw new Error(`solver errors: ${errors.join(' | ')}`);
    part.forEach((_, j) => {
      const a = answers[j];
      if (!a || a.status !== 'sat' || !a.values) res.push({ tag: 'fault', detail: `encoder: ${a?.status}` });
      else res.push(decodeOutcome(out, f.translation.ret, enc, shared, lookup(terms, a.values)));
    });
  }
  return res;
}

async function main() {
  const filter = process.argv[2] ?? '';
  const z3 = await openSystemZ3();
  if (!z3) throw new Error('no system z3');
  const sandbox = await Sandbox.open();
  const rows = [];
  try {
    for (const k of loadCases().filter((x) => x.name.includes(filter))) {
      const o = fnut(k.original, k.fn);
      const c = fnut(k.candidate, k.fn);
      if (o.refused || c.refused) {
        rows.push({ name: k.name, verdict: 'REFUSED', detail: o.refused ?? c.refused });
        console.log(k.name, 'REFUSED', o.refused ?? c.refused);
        continue;
      }
      for (const b of k.bounds) {
        const r = await checkEquivalent(o, c, b, 120_000, z3, { sandbox });
        const inputs = k.inputs ?? enumerate(o.translation, k.domain ?? {}, b);
        const [oo, co] = await runInstrumented([o.translation, c.translation], inputs, { sandbox });
        const allDiffs = truthDiffs(inputs, oo, co);
        // round 3: an unsat may come back with bounds.int NARROWED; the claim is then about the narrowed box only
        const narrowedTo = r.status === 'unsat' && r.bounds.int < b.int ? r.bounds.int : null;
        const diffs = narrowedTo === null ? allDiffs : allDiffs.filter((d) => maxAbs(d.input) <= narrowedTo);
        // sanity on the same inputs (cap at 600 per function)
        const sample = inputs.length > 600 ? inputs.filter((_, i) => i % Math.ceil(inputs.length / 600) === 0) : inputs;
        const sIdx = sample.map((x) => inputs.indexOf(x));
        let eo, ec;
        try {
          eo = await encEval(o, sample, b, b.unroll, z3);
          ec = await encEval(c, sample, b, b.unroll, z3);
        } catch (e) {
          console.log(k.name, 'encEval failed:', String(e.message).slice(0, 200));
          eo = ec = sample.map(() => ({ tag: 'fuel' }));
        }
        const sanityMism = [];
        sIdx.forEach((i, j) => {
          for (const [name, e, t] of [['original', eo[j], oo[i]], ['candidate', ec[j], co[i]]]) {
            if (e.tag === 'fuel' || t.tag === 'fault') continue;
            if (!outcomeEqual(e, t)) sanityMism.push({ which: name, input: inputs[i], encoder: e, ts: t });
          }
        });
        const exhaustive = !k.inputs;
        let verdict;
        if (r.status === 'unsat' && diffs.length) verdict = 'BUG-A?';
        else if (r.status === 'inconclusive') verdict = 'BUG-B (inconclusive)';
        else if (k.expect === 'narrowed' && !(r.status === 'unsat' && narrowedTo !== null)) verdict = `EXPECTED narrowed unsat, got ${r.status}`;
        else if (k.expect === 'not-unsat' && r.status === 'unsat') verdict = 'BUG-A? not-unsat answered unsat';
        else if (r.status === 'sat' && (k.expect === 'equal' || k.expect === 'equal-or-narrowed')) verdict = 'BUG? sat on expected-equal';
        else if (r.status === 'sat' && !diffs.some((d) => JSON.stringify(d.input) === JSON.stringify(r.counterexample.input)) && exhaustive) verdict = 'CHECK sat witness not in truth set';
        else if (r.status === 'unsat' && k.expect === 'diff' && exhaustive && narrowedTo === null) verdict = 'CHECK unsat on expected-diff (truth set empty)';
        else if (r.status !== 'sat' && r.status !== 'unsat') verdict = `OTHER ${r.status}`;
        else verdict = 'held';
        if (sanityMism.length) verdict += ` +SANITY(${sanityMism.length})`;
        const row = {
          name: k.name,
          bounds: b,
          status: r.status,
          reason: r.reason,
          cex: r.counterexample ? { input: r.counterexample.input, o: r.counterexample.original, c: r.counterexample.candidate, pred: r.counterexample.predicted } : undefined,
          truthDiffs: diffs.length,
          allTruthDiffs: allDiffs.length,
          coverage: r.coverage,
          firstDiff: diffs[0],
          inputs: inputs.length,
          sanity: sanityMism.slice(0, 3),
          verdict,
          ms: Math.round(r.ms),
        };
        rows.push(row);
        console.log(JSON.stringify(row));
      }
    }
  } finally {
    await sandbox.close();
  }
  const bad = rows.filter((r) => r.verdict !== 'held');
  console.log(`\n${rows.length} runs, ${bad.length} not held`);
  for (const r of bad) console.log(' ', r.name, r.verdict);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) await main();
