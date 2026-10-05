/**
 * Red team, round 1, area "control" (loops, measures, shadowing, early return, throw, Option returns).
 * Cases: packages/translate/corpus-redteam/control/*.ts. Header lines:
 *   `// @redteam area=control status=held|divergence [input=<JSON args> ts=<outcome> lean=<outcome>]`
 *   `// @redteam-expect ok | refuse:<RefusalCode>`   what translate() does (held) or MUST do (divergence)
 *   `// @redteam-inputs <JSON array of argument arrays>`   explicit edge inputs (expect=ok)
 *   `// @redteam-fault-inputs <JSON>`   inputs on which the TypeScript faults; the correct behavior is that the Lean
 *                                        precondition `pre` is false on them (the model must not claim a value there)
 *   `// @redteam-fn <name>`   the function to translate (default: the first exported one)
 *   `// @redteam-note <text>`
 * Every expect=ok case: the Lean model compiles with tier `proved` for every definition, and tsVsLean on the explicit
 * inputs plus 25 generated ones shows zero disagreements. Divergence cases are written as the CORRECT behavior, so
 * they FAIL until the translator (or its preconditions) is fixed. They are deliberately not `it.fails`.
 * Round 3 (2026-10-05): cases `r3*`. Open divergences: `r3LoopEmptyStr*` / `r3RecEmptyStr*` / `r3RecEmptyTmplLeft`
 * (empty-string literal on the LEFT of `!==`/`!=`/`===` as a shrink guard: accepted, but the Lean termination proof
 * fails); they fail at the "compiles (proved)" assertion until lowering or `faithful_len_pos` (Core.lean) is fixed.
 * Round 4 (2026-10-05): cases `r4*`. All earlier divergence cases now pass (fixed; their headers still say
 * `status=divergence`). Open divergences: `r4ModuleOctalConstRead`, `r4ModuleLeadingZeroConstRead`,
 * `r4ModuleOctalEscapeConstRead` (a module constant the function reads is not valid strict-mode JavaScript, e.g.
 * `const K = 010`: TypeScript reports an error outside the function statement, translate() ignores it and inlines the
 * sloppy value, while the ES module cannot load). They fail at the acceptance assertion (expected refusal
 * `unsupported-syntax`) until translate() checks the diagnostics of the module constants it reads. Not `it.fails`.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveLeanDir } from '@faithful/core';
import { leanPredicateExpr, listExportedFunctions, translate, type Translation, type Val } from '@faithful/translate';
import { Sandbox, liveSandboxWorkers } from './sandbox/sandbox.js';
import { tsVsLean, type LeanEvaluator } from './differential/differential.js';

const hasLean = !process.env.FAITHFUL_SKIP_LEAN && resolveLeanDir() !== null;
const here = dirname(fileURLToPath(import.meta.url));
const DIR = join(here, '../../translate/corpus-redteam/control');
const SEED = 20261005;
const N_GEN = 25;

interface Case {
  name: string;
  source: string;
  fnName: string;
  status: 'held' | 'divergence';
  expect: { ok: true } | { ok: false; code: string };
  inputs: Val[][];
  faultInputs: Val[][];
}

function load(): Case[] {
  const out: Case[] = [];
  for (const f of readdirSync(DIR).filter((x) => x.endsWith('.ts')).sort()) {
    const source = readFileSync(join(DIR, f), 'utf8');
    const lines = source.split('\n');
    const head = lines.find((l) => l.startsWith('// @redteam '));
    if (!head) throw new Error(`${f}: no // @redteam header`);
    const status = /status=(held|divergence)/.exec(head)?.[1] as Case['status'] | undefined;
    if (!status || !/area=control/.test(head)) throw new Error(`${f}: malformed header ${head}`);
    const exp = lines.find((l) => l.startsWith('// @redteam-expect '))?.slice('// @redteam-expect '.length).trim();
    if (!exp) throw new Error(`${f}: no // @redteam-expect`);
    const json = (tag: string): Val[][] => {
      const l = lines.find((x) => x.startsWith(`// @redteam-${tag} `));
      return l ? (JSON.parse(l.slice(`// @redteam-${tag} `.length)) as Val[][]) : [];
    };
    const fnName =
      lines.find((x) => x.startsWith('// @redteam-fn '))?.slice('// @redteam-fn '.length).trim() ??
      listExportedFunctions(source).find((x) => x.exported)?.name;
    if (!fnName) throw new Error(`${f}: no exported function`);
    out.push({
      name: f.replace(/\.ts$/, ''),
      source,
      fnName,
      status,
      expect: exp === 'ok' ? { ok: true } : { ok: false, code: exp.replace(/^refuse:/, '') },
      inputs: json('inputs'),
      faultInputs: json('fault-inputs'),
    });
  }
  return out;
}

const cases = load();

async function leanEvaluator(): Promise<LeanEvaluator> {
  const { evalBatch } = await import('../../prover/src/lean.js');
  return { evalBatch: (prelude, exprs, opts) => evalBatch(prelude, exprs, opts) };
}

describe('redteam control: translate() acceptance', () => {
  it('has at least 25 cases', () => {
    expect(cases.length).toBeGreaterThanOrEqual(25);
  });
  for (const c of cases) {
    it(`${c.status} ${c.name}: ${c.expect.ok ? 'accepted' : 'refused ' + c.expect.code}`, () => {
      const r = translate(c.source, c.fnName);
      if (c.expect.ok) expect(r.ok ? 'ok' : `refused ${r.refusal.code}: ${r.refusal.reason}`).toBe('ok');
      else expect(r.ok ? 'accepted' : r.refusal.code).toBe(c.expect.code);
    });
  }
});

describe.skipIf(!hasLean)('redteam control: Lean model vs TypeScript (real Lean)', () => {
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
  for (const c of cases.filter((x) => x.expect.ok)) {
    it(
      `${c.status} ${c.name}: compiles (proved), zero disagreements, faults excluded by pre`,
      async () => {
        const r = translate(c.source, c.fnName);
        expect(r.ok).toBe(true);
        if (!r.ok) return;
        const t: Translation = r;
        const { checkLean } = await import('../../prover/src/lean.js');
        const defs = [...t.lean.source.matchAll(/^def (\S+)/gm)].map((m) => `Model.${m[1]}`);
        const chk = await checkLean({ source: t.lean.source, theorems: defs, budgetMs: 180_000 });
        expect(chk.diagnostics.filter((d) => d.severity === 'error').map((d) => `${d.line}: ${d.message}`)).toEqual([]);
        for (const d of defs) expect(chk.axioms[d]?.tier, `${d}`).toBe('proved');

        const explicit = await tsVsLean(t, { n: 0, seed: SEED, inputs: c.inputs, perCallMs: 2000 }, { lean, sandbox: sb });
        expect(explicit.disagreements, JSON.stringify(explicit.disagreements.slice(0, 3))).toEqual([]);
        const gen = await tsVsLean(t, { n: N_GEN, seed: SEED, perCallMs: 500 }, { lean, sandbox: sb });
        expect(gen.disagreements, JSON.stringify(gen.disagreements.slice(0, 3))).toEqual([]);

        // Inputs on which the TypeScript faults (e.g. RangeError: Maximum call stack size exceeded) must lie outside the
        // model's precondition; otherwise a theorem `pre args -> ...` speaks about a value JavaScript never produces.
        if (c.faultInputs.length > 0) {
          const res = await lean.evalBatch(t.lean.source, c.faultInputs.map((a) => leanPredicateExpr(t, 'pre', a)), { budgetMs: 120_000 });
          // Round 2: since the depth fix the instrumented TS reports these inputs as range-violation (depth check) before
          // V8 overflows (the round-1 assertion `tag === 'fault'` described the unfixed system). Required now: the
          // instrumented TS outcome is `fault` or `range-violation` (never ok/throw), and the Lean precondition is false.
          for (const [k, a] of c.faultInputs.entries()) {
            const one = await tsVsLean(t, { n: 0, seed: SEED, inputs: [a], perCallMs: 2000 }, { lean, sandbox: sb });
            expect(one.tsFaults + one.rangeExcluded, `TS on ${JSON.stringify(a)} must be fault or range-violation`).toBe(1);
            expect(res.outputs[k], `Lean pre on ${JSON.stringify(a)}`).toBe('false');
          }
        } else {
          expect(explicit.tsFaults, JSON.stringify(explicit.tsFaultSamples)).toBe(0);
        }
      },
      600_000,
    );
  }
});
