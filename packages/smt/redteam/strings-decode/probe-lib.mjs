// Shared by probe.mjs / probe-adv.mjs: sanity mode on concrete inputs (encoding evaluated by Z3 vs the sandbox).
import { Sandbox, outcomeEqual } from '@faithful/engine';
import { openZ3, runInstrumented, Encoder, declareInput, Smt } from '../../dist/index.js';
import { outcomeTerms, lookup, decodeOutcome } from '../../dist/outcome.js';
import { readAnswers, transcript } from '../../dist/sexpr.js';
import { and } from '../../dist/terms.js';
import { eqConst } from '../../dist/values.js';

let z3;
let sandbox;
async function env() {
  z3 ??= await openZ3('system');
  sandbox ??= await Sandbox.open();
  return { z3, sandbox };
}

function shapeOf(v) {
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

export async function concreteMismatches(f, inputs, unroll = 14) {
  const { z3, sandbox } = await env();
  if (inputs.length === 0) return [];
  const params = f.translation.params.map((p) => p.ty);
  const sh = inputs.flat(1).map(shapeOf).reduce((m, x) => ({ array: Math.max(m.array, x.array), string: Math.max(m.string, x.string) }), { array: 0, string: 0 });
  const b = { array: Math.max(1, sh.array), string: Math.max(1, sh.string), int: 2 ** 53 };
  const smt = new Smt({ maxChars: 30_000_000 });
  smt.emit('(set-option :produce-models true)');
  const shared = { msgs: [] };
  const ins = params.map((ty, i) => declareInput(smt, ty, b, `in${i}`));
  for (const x of ins) smt.assert(x.dom);
  const enc = new Encoder(smt, f.ir, { unroll, shared });
  const out = enc.run(ins.map((x) => x.v));
  const base = smt.text();
  const terms = outcomeTerms(out);
  const script = inputs
    .map((a) => `(reset)\n${base}\n(assert ${and(...a.map((v, i) => eqConst(ins[i].v, v, params[i])))})\n(check-sat)\n(get-value (${terms.join(' ')}))`)
    .join('\n');
  const r = await z3.solve(script, { timeoutMs: 120_000 });
  const { answers, errors } = readAnswers(transcript(r));
  if (errors.length) return [{ errors }];
  const [tsr] = await runInstrumented([f.translation], inputs, { sandbox });
  const bad = [];
  inputs.forEach((a, i) => {
    const ans = answers[i];
    const t = tsr[i];
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

