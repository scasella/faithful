import { chmod, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { resolveConfig, resolveLeanDir } from '@faithful/core';
import { translate, type Translation } from '@faithful/translate';
import { Sandbox } from '@faithful/engine';
import { CodexClient, evalBatch } from '@faithful/prover';
import { challengeSearch } from './challenge.js';
import { carveOptions, makeCarveOut } from './carveout.js';
import { SessionRuntime } from './runtime.js';
import { deliver } from './deliver.js';
import { verifyDirectory } from './verify.js';
import { renameFunction, findFunction, normalizeSource, buildCandidatePrompt } from './candidate.js';
import { stripRecordDecls } from './optimize.js';

const hasLean = !process.env.FAITHFUL_SKIP_LEAN && resolveLeanDir() !== null;

const SUM_TS = `/** Sum of all elements. */\nexport function sum(xs: number[]): number {\n  return xs.reduce((acc, x) => acc + x, 0);\n}\n`;
const ABS_TS = `export function absDiff(a: number, b: number): number {\n  return a > b ? a - b : b - a;\n}\n`;

const lean = { evalBatch: (p: string, e: string[], o: { budgetMs: number }) => evalBatch(p, e, o) };

describe('candidate helpers (pure)', () => {
  it('renames a function including self-calls but not properties', () => {
    const src = 'export function f(n: number): number { return n < 2 ? n : f(n - 1) + f(n - 2); }';
    expect(renameFunction(src, 'f', 'f_cand')).toBe('export function f_cand(n: number): number { return n < 2 ? n : f_cand(n - 1) + f_cand(n - 2); }');
    expect(renameFunction('const o = {f: 1}; export function g(){ return o.f; }', 'f', 'h')).toContain('o.f');
  });
  it('finds a function with its JSDoc and normalizes whitespace/comments', () => {
    const f = findFunction('const x = 1;\n/** doc */\nexport function a(): number { return 1; }\n', 'a')!;
    expect(f.text.startsWith('/** doc */')).toBe(true);
    expect(normalizeSource('// c\nfoo( 1 )   ;')).toBe(normalizeSource('foo( 1 ) ;'));
  });
  it('the candidate prompt carries the spec and the previous rejection, and no test inputs', () => {
    const p = buildCandidatePrompt({
      fn: 'f', original: 'orig', specEnglish: 'E', specLean: 'L', preconditions: [{ id: 'a', kind: 'int-bound', words: 'W', lean: 'x' }], carveOuts: [],
      incumbent: { source: 'inc', timing: '1 ms' }, distribution: 'D', round: 2,
      previous: { source: 'prev', rejection: { stage: 'smt', kind: 'smt-counterexample', reason: 'differs', counterexample: { input: [2], original: { tag: 'ok', value: 1 }, candidate: { tag: 'ok', value: 2 }, source: 'smt' } } },
    });
    expect(p).toContain('Counterexample input: [2]');
    expect(p).toContain('AGREED SPECIFICATION');
    expect(p).not.toMatch(/differential inputs/i);
  });
  it('strips record declarations a second model would redefine', () => {
    const body = 'namespace Model\n\nstructure Rec1 where\n  x : Int\n  deriving Repr\n\ninstance : Lean.ToJson Rec1 := ⟨fun r => r.x⟩\n\ndef f := 1\nend Model';
    const out = stripRecordDecls(body);
    expect(out).not.toContain('structure Rec1');
    expect(out).not.toContain('ToJson Rec1');
    expect(out).toContain('def f := 1');
  });
});

describe('carve-outs (deterministic)', () => {
  const t = translate(ABS_TS, 'absDiff') as Translation;
  it('offers classes from the disagreeing input and generates matching Lean and TS predicates', () => {
    const opts = carveOptions(t, [-3, 4]);
    expect(opts.map((o) => o.cls.kind)).toContain('negative');
    const c = makeCarveOut(t, [-3, 4], { param: 0, kind: 'negative' });
    expect(c.kind).toBe('carve-out');
    expect(c.words).toMatch(/a is negative/);
    // `ts` is true for KEPT inputs
    const keep = new Function('a', 'b', `return ${c.ts}`) as (a: number, b: number) => boolean;
    expect(keep(-3, 4)).toBe(false);
    expect(keep(3, 4)).toBe(true);
    expect(c.lean).toContain('a ≥ 0');
  });
});

describe.skipIf(!hasLean)('challenge search (real Lean)', () => {
  let sb: Sandbox;
  beforeAll(async () => { sb = await Sandbox.open(); });
  afterAll(async () => { await sb.close(); });
  const t = translate(SUM_TS, 'sum') as Translation;
  const run = (spec: string) => challengeSearch(t, spec, { n: 120, seed: 5, throwChoice: null, carveOuts: [] }, { lean, sandbox: sb });

  it('finds no disagreement for a correct spec', async () => {
    const r = await run('namespace Spec\ndef spec (xs : List Int) : Int := xs.foldr (· + ·) 0\nend Spec');
    expect(r.run.totalDisagreements).toBe(0);
    expect(r.run.inputsCompared).toBeGreaterThan(50);
  }, 120_000);
  it('lists disagreements (boundary first) for a wrong spec', async () => {
    const r = await run('namespace Spec\ndef spec (xs : List Int) : Int := if xs.length ≥ 2 then xs.foldr (· + ·) 0 + 1 else xs.foldr (· + ·) 0\nend Spec');
    expect(r.run.totalDisagreements).toBeGreaterThan(0);
    const d = r.run.disagreements[0]!;
    expect(d.spec).not.toEqual(d.original);
  }, 120_000);
});

/** Scripted Codex: answers from a queue, one per invocation. */
async function scripted(answers: unknown[]): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'fake-codex-'));
  const counter = join(dir, 'n');
  await writeFile(counter, '0');
  for (let i = 0; i < answers.length; i++) await writeFile(join(dir, `a${i}.json`), JSON.stringify(answers[i]));
  const p = join(dir, 'codex');
  await writeFile(p, `#!/bin/sh\nOUT=""; while [ $# -gt 0 ]; do [ "$1" = "-o" ] && OUT="$2"; shift; done\nN=$(cat ${counter}); echo $((N+1)) > ${counter}\ncat >/dev/null\ncp ${dir}/a$N.json "$OUT"\n`);
  await chmod(p, 0o755);
  return p;
}

describe.skipIf(!hasLean)('session runtime: spec -> agree -> prove -> deliver -> verify (scripted model, real Lean)', () => {
  it('runs the whole original-only path and the delivered files re-verify', async () => {
    const repo = await mkdtemp(join(tmpdir(), 'faithful-repo-'));
    await mkdir(join(repo, 'src'));
    await writeFile(join(repo, 'src/sum.ts'), SUM_TS);
    const bin = await scripted([
      { lean: 'namespace Spec\ndef spec (xs : List Int) : Int := xs.foldl (· + ·) 0\nend Spec', lines: [{ lean: 'def spec (xs : List Int) : Int := xs.foldl (· + ·) 0', english: 'Add the elements from left to right, starting from 0.' }], properties: [], english: 'The sum of the list.' },
      { helpers: '', proof: 'by\n  intro xs _\n  rfl', reasoning: 'both are a left fold' },
    ]);
    const codex = new CodexClient({ ...resolveConfig({}), codexBin: bin, codexTimeoutMs: 30_000 });
    const rt = new SessionRuntime({ repoRoot: repo, codex });
    try {
      await rt.openFunction('src/sum.ts', 'sum');
      expect(rt.translation?.fnName).toBe('sum');
      const p = await rt.proposeSpec();
      expect(p.validation.ok).toBe(true);
      expect(rt.agreeBlocker()).toBeNull();
      const ag = await rt.agree();
      expect(ag.hash).toMatch(/^sha256:/);
      const pv = await rt.proveOriginal({ maxAttempts: 2, minutes: 5 });
      expect(pv.result).toBe('proved');
      expect(rt.state.calls.length).toBe(2);
      const d = await deliver(rt);
      expect(d.files).toEqual(expect.arrayContaining(['sum.lean', 'spec.md', 'sum.provenance.json', 'VERIFY.md', 'patch.diff']));
      expect(d.evidence).toContain('Proved');
      expect(d.evidence).toContain('checked against the TypeScript on');
      const prov = JSON.parse(await readFile(join(repo, '.faithful/sum/sum.provenance.json'), 'utf8'));
      expect(prov.claims[0]).toMatchObject({ kind: 'original-meets-spec', tier: 'proved' });
      // the user's file is untouched
      expect(await readFile(join(repo, 'src/sum.ts'), 'utf8')).toBe(SUM_TS);
      // a reviewer can re-check it
      const rep = await verifyDirectory(join(repo, '.faithful/sum'));
      expect(rep.checks.filter((c) => !c.ok)).toEqual([]);
      expect(rep.ok).toBe(true);
      // resume from files
      const rt2 = new SessionRuntime({ repoRoot: repo, codex });
      expect(await rt2.resume('sum')).toBe(true);
      expect(rt2.state.agreement?.hash).toBe(ag.hash);
      await rt2.close();
    } finally {
      await rt.close();
    }
  }, 400_000);

  it('blocks Agree while the spec disagrees with the original', async () => {
    const repo = await mkdtemp(join(tmpdir(), 'faithful-repo-'));
    await mkdir(join(repo, 'src'));
    await writeFile(join(repo, 'src/sum.ts'), SUM_TS);
    const bin = await scripted([{ lean: 'namespace Spec\ndef spec (xs : List Int) : Int := xs.length\nend Spec', lines: [], properties: [], english: 'wrong on purpose' }]);
    const rt = new SessionRuntime({ repoRoot: repo, codex: new CodexClient({ ...resolveConfig({}), codexBin: bin, codexTimeoutMs: 30_000 }) });
    try {
      await rt.openFunction('src/sum.ts', 'sum');
      await rt.proposeSpec();
      expect(rt.agreeBlocker()).toMatch(/disagreement/);
      await expect(rt.agree()).rejects.toThrow(/disagreement/);
      const d = rt.state.challengeRuns.at(-1)!.disagreements[0]!;
      await rt.rule({ challengeId: d.id, ruling: 'function-wrong', then: 'fix-original' });
      expect(rt.agreeBlocker()).toMatch(/fix it|remain/);
    } finally {
      await rt.close();
    }
  }, 300_000);

  it('refuses a spec that calls the model', async () => {
    const repo = await mkdtemp(join(tmpdir(), 'faithful-repo-'));
    await mkdir(join(repo, 'src'));
    await writeFile(join(repo, 'src/sum.ts'), SUM_TS);
    const bin = await scripted([{ lean: 'namespace Spec\ndef spec (xs : List Int) : Int := Model.sum xs\nend Spec', lines: [], properties: [], english: 'vacuous' }]);
    const rt = new SessionRuntime({ repoRoot: repo, codex: new CodexClient({ ...resolveConfig({}), codexBin: bin, codexTimeoutMs: 30_000 }) });
    try {
      await rt.openFunction('src/sum.ts', 'sum');
      const p = await rt.proposeSpec();
      expect(p.validation.ok).toBe(false);
      expect(rt.agreeBlocker()).toMatch(/did not compile/);
    } finally {
      await rt.close();
    }
  }, 120_000);
});
