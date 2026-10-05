/**
 * Red-team rounds 1-4, area `strings`: every `.ts` file in packages/translate/corpus-redteam/strings/ is one probe
 * (round-2 probes are the `r2*` files, round-3 the `r3*` files, round-4 the `r4*` files; `*.evidence.lean` files are
 * supporting Lean evidence, not probes). Round 3 (2026-10-05): 60 new probes, all held; no new divergence.
 * Round 4 (2026-10-05): 55 new probes (string-literal and template line continuations / identity escapes, numeric
 * literal forms in string context, `declare global` type lies on String methods, record keys needing JSON escapes or
 * Lean-name mangling with collisions, option-return ternary splits with checked ops, string comparator readings,
 * case maps inside callbacks), all held; no new divergence. Every earlier `status=divergence` probe passes (fixed).
 * `RT_ONLY=<regex>` restricts the run to matching probe names, e.g. `RT_ONLY='^r4'`.
 *
 * Header lines (all start with `// @redteam ` or `// @inputs `):
 *   `// @redteam area=strings status=held|divergence [expect=ok|refuse] [code=<RefusalCode>] [input=<JSON args> ts=<outcome> lean=<outcome>]`
 *   `// @inputs <JSON array of argument lists>`   hand-picked edge inputs (optional)
 *
 * Expectations encode the CORRECT behaviour, so a `status=divergence` probe FAILS until the translator is fixed:
 *   - expect=refuse (default when `code=` is given): translate() refuses with exactly `code`;
 *   - expect=ok (default otherwise): translate() accepts, and tsVsLean (the real differential harness, real Lean) on the
 *     hand-picked inputs, the divergence input, and 150 generated inputs reports zero disagreements of any kind
 *     (outcome, range-ok, instrumentation, lean-error).
 * Some expect=refuse divergences are "the translator crashes instead of refusing": translate() must return a refusal,
 * never throw.
 * A divergence with `ts=fault...` (round 2, r2StrLengthLimit: V8 throws RangeError on a string longer than 2^29 - 24
 * units while Lean `pre` is true) additionally requires that the instrumented original does NOT fault on the explicit
 * inputs: inside the model it must return/throw, outside it must report range-violation. A fault is never agreement,
 * and the harness silently drops faulting inputs, so without this check such a probe would pass vacuously.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveLeanDir } from '@faithful/core';
import { listExportedFunctions, translate, type TranslationResult, type Val } from '@faithful/translate';
import { Sandbox } from './sandbox/sandbox.js';
import { tsVsLean, type LeanEvaluator, type TsVsLeanReport } from './differential/differential.js';

const hasLean = !process.env.FAITHFUL_SKIP_LEAN && resolveLeanDir() !== null;
const here = dirname(fileURLToPath(import.meta.url));
const DIR = join(here, '../../translate/corpus-redteam/strings');

interface Probe {
  name: string;
  source: string;
  fnName: string;
  status: 'held' | 'divergence';
  expect: 'ok' | 'refuse';
  code?: string;
  inputs: Val[][];
  /** The `ts=` outcome of a divergence header starts with `fault`. */
  tsFault: boolean;
}

function parseProbe(name: string, source: string): Probe {
  const kv: Record<string, string> = {};
  let inputs: Val[][] = [];
  for (const line of source.split('\n')) {
    const r = /^\/\/ @redteam (.*)$/.exec(line.trimEnd());
    if (r) {
      // values may be JSON containing spaces only inside input=; parse input= greedily up to ' ts='
      const body = r[1]!;
      const inp = /input=(.*?) ts=/.exec(body);
      if (inp) kv.input = inp[1]!;
      for (const m of body.replace(/input=.*? ts=/, 'ts=').matchAll(/(\w+)=(\S+)/g)) kv[m[1]!] = m[2]!;
    }
    const i = /^\/\/ @inputs (.*)$/.exec(line.trimEnd());
    if (i) inputs = JSON.parse(i[1]!) as Val[][];
  }
  if (kv.area !== 'strings') throw new Error(`${name}: missing area=strings`);
  if (kv.status !== 'held' && kv.status !== 'divergence') throw new Error(`${name}: bad status`);
  if (kv.input) inputs = [JSON.parse(kv.input) as Val[], ...inputs];
  const fns = listExportedFunctions(source).filter((f) => f.exported);
  if (fns.length !== 1) throw new Error(`${name}: expected one exported function, got ${fns.length}`);
  const exp = (kv.expect ?? (kv.code ? 'refuse' : 'ok')) as 'ok' | 'refuse';
  return { name, source, fnName: fns[0]!.name, status: kv.status, expect: exp, code: kv.code, inputs, tsFault: kv.status === 'divergence' && (kv.ts ?? '').startsWith('fault') };
}

// RT_ONLY=<regex> restricts the run to probes whose name matches (for iterating on one round's probes).
const only = process.env.RT_ONLY ? new RegExp(process.env.RT_ONLY) : null;
const probes: Probe[] = readdirSync(DIR)
  .filter((f) => f.endsWith('.ts'))
  .filter((f) => !only || only.test(f.replace(/\.ts$/, '')))
  .sort()
  .map((f) => parseProbe(f.replace(/\.ts$/, ''), readFileSync(join(DIR, f), 'utf8')));

function safeTranslate(p: Probe): TranslationResult | { crashed: string } {
  try {
    return translate(p.source, p.fnName);
  } catch (e) {
    return { crashed: e instanceof Error ? e.message : String(e) };
  }
}

async function leanEvaluator(): Promise<LeanEvaluator> {
  const { evalBatch } = await import('../../prover/src/lean.js');
  return { evalBatch: (prelude, exprs, opts) => evalBatch(prelude, exprs, opts) };
}

function summarize(r: TsVsLeanReport): string {
  return JSON.stringify(
    r.disagreements.slice(0, 4).map((d) => ({ kind: d.kind, args: d.args, ts: d.ts, lean: d.lean, plain: d.plain, predicates: d.predicates, detail: d.detail.slice(0, 300) })),
  );
}

describe('red team strings: probe files', () => {
  it('has at least 25 probes, every one well-formed', () => {
    expect(probes.length).toBeGreaterThanOrEqual(only ? 1 : 25);
  });
});

describe('red team strings: acceptance / refusal', () => {
  for (const p of probes) {
    it(`${p.name} [${p.status}]: ${p.expect}${p.code ? ' ' + p.code : ''}`, () => {
      const r = safeTranslate(p);
      if ('crashed' in r) expect.fail(`translate() threw instead of returning a result: ${r.crashed}`);
      const tr = r as TranslationResult;
      if (p.expect === 'refuse') {
        expect(tr.ok ? 'accepted' : tr.refusal.code).toBe(p.code);
      } else {
        expect(tr.ok ? 'ok' : `refused ${tr.refusal.code}: ${tr.refusal.reason}`).toBe('ok');
      }
    });
  }
});

describe.skipIf(!hasLean)('red team strings: tsVsLean (real Lean)', () => {
  let sb: Sandbox;
  let lean: LeanEvaluator;
  beforeAll(async () => {
    sb = await Sandbox.open({ defaultTimeoutMs: 1000 });
    lean = await leanEvaluator();
  });
  afterAll(async () => {
    await sb.close();
  });
  for (const p of probes.filter((q) => q.expect === 'ok')) {
    it(`${p.name} [${p.status}]: zero disagreements`, async () => {
      const r = safeTranslate(p);
      if ('crashed' in r || !r.ok) return expect.fail(`not translated: ${JSON.stringify(r)}`);
      const explicit = p.inputs.length
        ? await tsVsLean(r, { n: 0, seed: 1, inputs: p.inputs, perCallMs: 500 }, { lean, sandbox: sb })
        : null;
      const gen = await tsVsLean(r, { n: 150, seed: 20261005, perCallMs: 500 }, { lean, sandbox: sb });
      if (explicit) expect(explicit.disagreements.length, `explicit inputs: ${summarize(explicit)}`).toBe(0);
      if (explicit && p.tsFault)
        expect(explicit.tsFaults, `instrumented original faulted where it must report range-violation: ${JSON.stringify(explicit.tsFaultSamples)}`).toBe(0);
      expect(gen.disagreements.length, `generated inputs: ${summarize(gen)}`).toBe(0);
      // the explicit inputs must actually exercise the model (not all rejected or faulted)
      if (explicit) expect(explicit.compared + explicit.rangeExcluded).toBeGreaterThan(0);
    }, 300_000);
  }
});
