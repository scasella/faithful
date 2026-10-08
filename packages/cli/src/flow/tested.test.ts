/**
 * The Tested-only path end to end, with real components (sandbox, compile gate, purity gate, signature generator,
 * mutation check, benchmark, delivery, verify) and a SCRIPTED Codex. No Lean is involved, so nothing here is gated on it.
 */
import { chmod, mkdir, mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { resolveConfig } from '@faithful/core';
import { CodexClient } from '@faithful/prover';
import type { Val } from '@faithful/translate';
import { createApi } from '../api.js';
import { SessionRuntime } from './runtime.js';
import { TestedOptimizer, buildTestedPrompt, candidateExtras, deliverTested } from './tested.js';
import { verifyDirectory } from './verify.js';

/** Scripted Codex: answers from a queue, one per invocation (same as flow.test.ts). Out of answers: the call fails. */
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

/** Refused (bare `/`), and slow on purpose: every element is copied into a one-element array and reduced. */
const AVERAGE_TS = `/**
 * Arithmetic mean.
 * @throws Error("average of empty list") when xs is empty
 */
export function average(xs: number[]): number {
  if (xs.length === 0) {
    throw new Error('average of empty list');
  }
  let sum = 0;
  for (let i = 0; i < xs.length; i++) {
    sum = sum + xs.slice(i, i + 1).reduce((a, b) => a + b, 0);
  }
  return sum / xs.length;
}
`;

/** Wrong only on non-integer elements (truncates them); equal on every integer input. */
const WRONG_ON_FLOATS = `export function average(xs: number[]): number {
  if (xs.length === 0) {
    throw new Error('average of empty list');
  }
  let sum = 0;
  for (let i = 0; i < xs.length; i++) {
    sum = sum + Math.trunc(xs[i]!);
  }
  return sum / xs.length;
}`;

/** Same additions in the same order, without the copies: equal and faster. */
const FAST = `export function average(xs: number[]): number {
  const n = xs.length;
  if (n === 0) {
    throw new Error('average of empty list');
  }
  let sum = 0;
  for (let i = 0; i < n; i++) {
    sum = sum + xs[i]!;
  }
  return sum / n;
}`;

async function repoWith(file: string, text: string): Promise<string> {
  const repo = await mkdtemp(join(tmpdir(), 'faithful-tested-'));
  await mkdir(join(repo, 'src'));
  await writeFile(join(repo, file), text);
  return repo;
}

describe('Tested-only path (scripted model, real sandbox, no Lean)', () => {
  it('a refused float function: catches a candidate wrong only on non-integers, keeps a faster equal one, delivers Tested, and re-verifies', async () => {
    const repo = await repoWith('src/stats.ts', AVERAGE_TS);
    const bin = await scripted([
      { source: WRONG_ON_FLOATS, idea: 'skip the copies' },
      { source: FAST, idea: 'index the array directly; same additions in the same order' },
    ]);
    const rt = new SessionRuntime({ repoRoot: repo, codex: new CodexClient({ ...resolveConfig({}), codexBin: bin, codexTimeoutMs: 30_000 }) });
    try {
      await rt.openFunction('src/stats.ts', 'average');
      const tr = rt.state.translation;
      expect(tr && !tr.ok && tr.refusal.code).toBe('float');
      await rt.startTestedOnly();
      expect(rt.state.tested?.signature).toBe('average(xs: array of number)');
      // the original that runs is the extracted unit: the function by itself (it uses no other declaration)
      expect(rt.state.tested).toMatchObject({ original: 'extracted', included: [] });
      expect(rt.state.stage).toBe('translate');
      await expect(rt.startTestedOnly()).rejects.toThrow(/already started/);

      const why = await new TestedOptimizer(rt, { threshold: { kind: 'time-budget', minutes: 5 }, noNewRounds: 1, maxRounds: 3, differentialInputs: 400, bench: { trials: 9, minTrialMs: 5 } }).run();
      expect(why).toBe('no-new-candidate');
      const o = rt.state.optimize;
      expect(rt.state.stage).toBe('optimize');
      expect(o.candidates).toHaveLength(2);

      // candidate 1: caught by the float-aware generator, on an input with a non-integer element
      const c1 = o.candidates[0]!;
      expect(c1.outcome).toBe('rejected');
      expect(c1.rejection?.stage).toBe('differential');
      const input = c1.rejection!.counterexample!.input[0] as Val[];
      expect(input.some((x) => typeof x === 'number' && !Number.isInteger(x))).toBe(true);
      expect(c1.stages.map((s) => s.stage)).toEqual(['compile', 'purity', 'differential']);

      // candidate 2: equal on every generated input, faster with non-overlapping intervals, tier Tested
      const c2 = o.candidates[1]!;
      expect(c2.outcome).toBe('incumbent');
      expect(c2.tier).toBe('tested');
      expect(c2.speedup?.significant).toBe(true);
      expect(c2.speedup!.lo).toBeGreaterThan(1);
      expect(o.incumbentId).toBe(2);
      expect(c2.stages.map((s) => [s.stage, s.status])).toEqual([
        ['compile', 'pass'],
        ['purity', 'pass'],
        ['differential', 'pass'],
        ['smt', 'skipped'],
        ['proof', 'skipped'],
        ['benchmark', 'pass'],
      ]);
      const reason = (tr as { refusal: { reason: string } }).refusal.reason;
      for (const st of c2.stages.filter((s) => s.status === 'skipped')) expect(st.summary).toBe(`outside the verifiable subset: ${reason}`);
      const dd = c2.stages.find((s) => s.stage === 'differential')!.detail as { compared: number; mutation?: { caught: number; total: number }; nonIntegerInputs: number; specialInputs: number };
      expect(dd.compared).toBe(400);
      expect(dd.nonIntegerInputs).toBeGreaterThan(100);
      expect(dd.specialInputs).toBe(0);
      expect(dd.mutation!.total).toBeGreaterThan(0);
      expect(dd.mutation!.caught).toBeGreaterThan(0);

      // the prompt: the original with its JSDoc, the plain statement that no spec exists, the previous rejection
      const prompts = rt.state.calls.map((c) => c.prompt);
      expect(prompts[0]).toContain('there is NO formal specification');
      expect(prompts[0]).toContain('@throws Error("average of empty list")');
      expect(prompts[1]).toContain('YOUR PREVIOUS CANDIDATE');
      expect(prompts[1]).toMatch(/Counterexample input: \(\[.*\d\.\d/);
      expect(prompts.join('\n')).not.toMatch(/AGREED SPECIFICATION|```lean/);

      // delivery: Tested only, no Lean file, no spec, honest evidence
      const d = await deliverTested(rt);
      expect(d.files.sort()).toEqual(['VERIFY.md', 'average.provenance.json', 'patch.diff']);
      const listed = await readdir(join(repo, '.faithful/average'));
      expect(listed.some((f) => f.endsWith('.lean') || f === 'spec.md')).toBe(false);
      expect(d.evidence).toContain('400 differential inputs.');
      expect(d.evidence).toMatch(/\d+ of \d+ broken cop(y|ies) caught\./);
      expect(d.evidence).toMatch(/× faster \(95% CI/);
      expect(d.evidence).not.toMatch(/Proved|Verified/);
      const prov = JSON.parse(await readFile(join(repo, '.faithful/average/average.provenance.json'), 'utf8'));
      expect(prov.deliveredTier).toBe('tested');
      expect(prov.claims).toHaveLength(1);
      expect(prov.claims[0]).toMatchObject({ kind: 'candidate-vs-original-differential', tier: 'tested', inputs: 400 });
      expect(prov.hashes).toMatchObject({ leanFile: '', model: '', spec: '', agreement: '' });
      expect(prov.caveats.join('\n')).toContain(reason);
      expect(prov.testedOnly).toMatchObject({ refusal: { code: 'float' }, generator: { kind: 'signature', n: 400, specials: false }, original: { scope: 'extracted', included: [] } });
      expect(prov.testedOnly.original.unitHash).toMatch(/^sha256:[0-9a-f]{64}$/);
      const verify = await readFile(join(repo, '.faithful/average/VERIFY.md'), 'utf8');
      expect(verify).toContain('no Lean model, no agreed spec, no proof and no SMT check');
      expect(verify).not.toMatch(/lake env lean|\.lean\b/);
      const patch = await readFile(join(repo, '.faithful/average/patch.diff'), 'utf8');
      expect(patch).toContain('Optimized by Faithful (Tested; outside the verifiable subset, nothing proved)');
      expect(await readFile(join(repo, 'src/stats.ts'), 'utf8')).toBe(AVERAGE_TS);

      // faithful verify: hashes, no proof/SMT claim, the differential re-run
      const lines: string[] = [];
      const rep = await verifyDirectory(join(repo, '.faithful/average'), { log: (s) => lines.push(s) });
      expect(rep.checks.filter((c) => !c.ok)).toEqual([]);
      expect(rep.checks.map((c) => c.name)).toEqual(['original source hash', 'optimized source hash', 'patch hash', 'claims', 'original', 'signature', 'differential']);
      expect(rep.checks.find((c) => c.name === 'differential')!.detail).toMatch(/^400 inputs from the signature compared .* 0 differences/);
      expect(rep.evidence).toBe('400 differential inputs. Tested tier only: no proof or SMT claim exists for this function.');
      expect(lines.join('\n')).toContain('No Lean model, spec, proof or SMT claim exists for it');

      // a tampered optimized source is caught by verify
      prov.optimizedSource = WRONG_ON_FLOATS;
      await writeFile(join(repo, '.faithful/average/average.provenance.json'), JSON.stringify(prov));
      const bad = await verifyDirectory(join(repo, '.faithful/average'));
      expect(bad.ok).toBe(false);
    } finally {
      await rt.close();
    }
  }, 300_000);

  it('refuses the path for a function inside the subset, and for one whose signature cannot be generated', async () => {
    const repo = await repoWith('src/a.ts', 'export function inc(n: number): number {\n  return n + 1;\n}\nexport function mid<T>(xs: T[]): T | undefined {\n  return xs[Math.floor(xs.length / 2)];\n}\n');
    const rt = new SessionRuntime({ repoRoot: repo, codex: new CodexClient({ ...resolveConfig({}), codexBin: '/bin/false' }) });
    try {
      await rt.openFunction('src/a.ts', 'inc');
      await expect(rt.startTestedOnly()).rejects.toThrow(/inside the verifiable subset/);
      await rt.openFunction('src/a.ts', 'mid');
      expect(rt.state.translation?.ok).toBe(false);
      await expect(rt.startTestedOnly()).rejects.toThrow(/inputs cannot be generated .*generic/);
      expect(rt.state.tested ?? null).toBeNull();
    } finally {
      await rt.close();
    }
  }, 60_000);

  it('preflight: the function runs as an extracted unit; an import it uses, or a declaration it uses that fails at load, cannot (plain reason, before tested.started); unrelated imports and top-level code no longer block it', async () => {
    const repo = await repoWith('src/stats.ts', AVERAGE_TS);
    await writeFile(join(repo, 'src/imports.ts'), `/** ok */\nimport Helper from './helper.ts?worker';\nexport function spawn(): unknown { return new Helper(); }\n${AVERAGE_TS}`);
    await writeFile(join(repo, 'src/types.ts'), `import type { Helper } from './helper';\n${AVERAGE_TS}`);
    await writeFile(join(repo, 'src/uses.ts'), `import { scale } from './scale';\n${AVERAGE_TS.replace('return sum / xs.length;', 'return scale(sum) / xs.length;')}`);
    const rt = new SessionRuntime({ repoRoot: repo, codex: new CodexClient({ ...resolveConfig({}), codexBin: '/bin/false' }) });
    try {
      await rt.openFunction('src/stats.ts', 'average');
      expect(await rt.testedBlocker()).toBeNull();

      await rt.openFunction('src/types.ts', 'average');
      expect(rt.state.translation?.ok).toBe(false);
      expect(await rt.testedBlocker()).toBeNull();

      // an unrelated value import used to block every function in the file; the extracted unit leaves it out
      await rt.openFunction('src/imports.ts', 'average');
      expect(rt.state.translation?.ok).toBe(false);
      expect(await rt.testedBlocker()).toBeNull();

      // an import the function itself uses cannot be left out
      await rt.openFunction('src/uses.ts', 'average');
      expect(rt.state.translation?.ok).toBe(false);
      const why = await rt.testedBlocker();
      expect(why).toBe(
        "average cannot run on its own: it uses scale, imported from './scale' (line 14, column 10). The Tested tier runs the function in an isolated sandbox together with only the declarations it uses from its own file.",
      );
      const before = rt.events.length;
      await expect(rt.startTestedOnly()).rejects.toThrow(why!);
      expect(rt.events.slice(before).some((e) => e.event.kind === 'tested.started')).toBe(false);
      expect(rt.state.tested ?? null).toBeNull();

      // unrelated top-level code that touches ambient state or throws is left out too
      await writeFile(join(repo, 'src/ambient.ts'), `const T0 = Date.now();\nif (T0 > 0 && undefinedThing) {}\n${AVERAGE_TS}`);
      await rt.openFunction('src/ambient.ts', 'average');
      expect(await rt.testedBlocker()).toBeNull();

      // the preflight is still the real sandbox load of the unit: a declaration the function uses that fails at load is caught
      const usesAt = (decl: string) => `${decl}\n${AVERAGE_TS.replace('return sum / xs.length;', 'return (sum + K - K) / xs.length;')}`;
      await writeFile(join(repo, 'src/clock.ts'), usesAt('const K: number = Date.now();'));
      await rt.openFunction('src/clock.ts', 'average');
      expect(await rt.testedBlocker()).toBe(
        'average cannot run on its own: a declaration it uses from its file uses Date.now when the file loads. The Tested tier runs the function in an isolated sandbox together with the declarations it uses from its file, so those must load there without side effects.',
      );
      await writeFile(join(repo, 'src/throws.ts'), usesAt(`const K: number = JSON.parse('{');`));
      await rt.openFunction('src/throws.ts', 'average');
      expect(await rt.testedBlocker()).toMatch(/^average cannot run on its own: a declaration it uses from its file throws when the file loads \(SyntaxError: /);
      await expect(rt.startTestedOnly()).rejects.toThrow(/throws when the file loads/);
      expect(rt.state.tested ?? null).toBeNull();

      // the run's compile gate compiles every candidate next to the original: an original that does not compile alone is refused up front
      await writeFile(join(repo, 'src/dom.ts'), `const live = new Set<Worker>();\nexport function workers(n: number): number { return live.size + n / 2; }\n`);
      await rt.openFunction('src/dom.ts', 'workers');
      expect(await rt.testedBlocker()).toBe(
        "workers cannot run on its own: it and the declarations it uses do not compile by themselves (line 1, column 22: Cannot find name 'Worker'). The Tested tier runs the function in an isolated sandbox together with only the declarations it uses from its own file.",
      );

      // an original that faults on every generated input leaves nothing to compare
      await writeFile(join(repo, 'src/faults.ts'), `export function probe(x: number): number { return (globalThis as unknown as { k: number }).k + x / 2; }\n`);
      await rt.openFunction('src/faults.ts', 'probe');
      expect(await rt.testedBlocker()).toMatch(/^probe cannot be tested: it failed or took longer than 100 ms on each of the first 50 inputs generated from its signature \(first: .*globalThis.*\), so there is nothing to compare a faster version with\.$/);
    } finally {
      await rt.close();
    }
  }, 60_000);

  it('included state that other code in the file can change: tested.started carries the caveat, and so do VERIFY.md and the provenance', async () => {
    const repo = await repoWith('src/live.ts', `const live: number[] = [];\nexport function track(x: number): void {\n  live.push(x);\n}\nexport function mean(k: number): number {\n  return (live.length + k) / 2;\n}\n`);
    const rt = new SessionRuntime({ repoRoot: repo, codex: new CodexClient({ ...resolveConfig({}), codexBin: '/bin/false' }) });
    try {
      await rt.openFunction('src/live.ts', 'mean');
      expect(rt.state.translation?.ok).toBe(false);
      await rt.startTestedOnly();
      const caveat = 'other code in this file (line 3) can change live when it is called; nothing in the file calls it while the file loads and the comparison never called it, so the comparison saw only the starting value of live';
      expect(rt.state.tested).toMatchObject({ original: 'extracted', included: ['live'], caveats: [caveat] });
      await deliverTested(rt);
      const verify = await readFile(join(repo, '.faithful/mean/VERIFY.md'), 'utf8');
      expect(verify).toContain(`Caveat: ${caveat}.`);
      const prov = JSON.parse(await readFile(join(repo, '.faithful/mean/mean.provenance.json'), 'utf8'));
      expect(prov.caveats).toContain('Other code in this file (line 3) can change live when it is called; nothing in the file calls it while the file loads and the comparison never called it, so the comparison saw only the starting value of live.');
    } finally {
      await rt.close();
    }
  }, 60_000);

  it('extraction refuses (top-level code changes state the function reads) but the whole file loads: the whole file runs, as before extraction', async () => {
    const repo = await repoWith('src/count.ts', `let calls = 0;\ncalls++;\nexport function scaled(x: number): number {\n  return (x * calls) / 3;\n}\n`);
    const rt = new SessionRuntime({ repoRoot: repo, codex: new CodexClient({ ...resolveConfig({}), codexBin: '/bin/false' }) });
    try {
      await rt.openFunction('src/count.ts', 'scaled');
      expect(rt.state.translation?.ok).toBe(false);
      const p = await rt.testedPreflight();
      expect(p).toMatchObject({ ok: true, original: { scope: 'file' } });
      await rt.startTestedOnly();
      expect(rt.state.tested).toMatchObject({ original: 'file' });
      expect(rt.state.tested?.included).toBeUndefined();
      expect(rt.testedOriginal().source).toBe(rt.fileText);
    } finally {
      await rt.close();
    }
  }, 60_000);

  it('end to end with extraction: a file with an unrelated import and a module constant the function reads; the patch edits the real file and verify re-extracts the unit', async () => {
    const text = `import { readFileSync } from 'node:fs';\nexport function load(p: string): string {\n  return readFileSync(p, 'utf8');\n}\n/** Weight of each element. */\nconst W = 3;\nexport function weighted(xs: number[]): number {\n  let s = 0;\n  for (let i = 0; i < xs.length; i++) s = s + xs.slice(i, i + 1).reduce((a, b) => a + b * W, 0);\n  return s / 2;\n}\n`;
    const repo = await repoWith('src/w.ts', text);
    const fast = `export function weighted(xs: number[]): number {\n  let s = 0;\n  for (let i = 0; i < xs.length; i++) s = s + (0 + xs[i]! * 3);\n  return s / 2;\n}`;
    const bin = await scripted([{ source: fast, idea: 'no copies; W inlined' }]);
    const rt = new SessionRuntime({ repoRoot: repo, codex: new CodexClient({ ...resolveConfig({}), codexBin: bin, codexTimeoutMs: 30_000 }) });
    try {
      await rt.openFunction('src/w.ts', 'weighted');
      expect(rt.state.translation?.ok).toBe(false);
      await rt.startTestedOnly();
      expect(rt.state.tested).toMatchObject({ original: 'extracted', included: ['W'] });
      await new TestedOptimizer(rt, { threshold: { kind: 'time-budget', minutes: 5 }, noNewRounds: 1, maxRounds: 2, differentialInputs: 200, bench: { trials: 7, minTrialMs: 3 } }).run();
      const c = rt.state.optimize.candidates[0]!;
      expect(c.stages.find((x) => x.stage === 'differential')?.status).toBe('pass');
      expect(rt.state.calls[0]!.prompt).toContain('DECLARATIONS FROM THE SAME FILE THAT THE ORIGINAL USES');
      expect(rt.state.calls[0]!.prompt).toContain('const W = 3;');
      const d = await deliverTested(rt);
      void d;
      const verify = await readFile(join(repo, '.faithful/weighted/VERIFY.md'), 'utf8');
      expect(verify).toContain('The original ran together with these declarations from the same file: W (line 6); the rest of the file (imports and other code) was not loaded.');
      const prov = JSON.parse(await readFile(join(repo, '.faithful/weighted/weighted.provenance.json'), 'utf8'));
      expect(prov.testedOnly.original).toMatchObject({ scope: 'extracted', included: [{ kind: 'const', name: 'W', line: 6 }] });
      expect(prov.originalFileSource).toBe(text);
      if (c.outcome === 'incumbent') {
        const patch = await readFile(join(repo, '.faithful/weighted/patch.diff'), 'utf8');
        expect(patch).toContain('+  for (let i = 0; i < xs.length; i++) s = s + (0 + xs[i]! * 3);');
        expect(patch).toContain(' const W = 3;');
        const rep = await verifyDirectory(join(repo, '.faithful/weighted'));
        expect(rep.checks.filter((x) => !x.ok)).toEqual([]);
        expect(rep.checks.find((x) => x.name === 'original')?.detail).toContain('W (line 6)');
        // a recorded file whose extracted unit no longer matches is caught
        prov.originalFileSource = text.replace('const W = 3;', 'const W = 4;');
        await writeFile(join(repo, '.faithful/weighted/weighted.provenance.json'), JSON.stringify(prov));
        const bad = await verifyDirectory(join(repo, '.faithful/weighted'));
        expect(bad.ok).toBe(false);
      }
    } finally {
      await rt.close();
    }
  }, 300_000);

  it('an overloaded function is refused by the preflight, even though its whole file loads (the patch would splice one signature)', async () => {
    const repo = await repoWith('src/o.ts', `export function f(n: number): number;\nexport function f(n: string): string;\nexport function f(n: any): any {\n  return n / 1;\n}\n`);
    const rt = new SessionRuntime({ repoRoot: repo, codex: new CodexClient({ ...resolveConfig({}), codexBin: '/bin/false' }) });
    try {
      await rt.openFunction('src/o.ts', 'f');
      const p = await rt.testedPreflight();
      expect(p).toMatchObject({ ok: false });
      if (!p.ok) expect(p.reason).toMatch(/^f cannot run on its own: f is overloaded \(2 signatures before the implementation\); the Tested tier does not run overloaded functions yet \(line 1, column 1\)\./);
      await expect(rt.startTestedOnly()).rejects.toThrow(/overloaded/);
      expect(rt.state.tested).toBeFalsy();
    } finally {
      await rt.close();
    }
  }, 60_000);

  it('a candidate with top-level code besides the function is rejected at compile (only the function is delivered)', async () => {
    expect(candidateExtras(`const K = 3;\nexport function f(n: number): number { return n + K; }`, 'f', `const K = 7;\nexport function f(n: number): number { return n + 3; }`)).toEqual(['K']);
    expect(candidateExtras(`function helper(x: number): number { return x; }\nexport function f(n: number): number { return helper(n); }`, 'f', `export function f(n: number): number { return n; }`)).toEqual(['helper']);
    // a type the original also declares is fine (the file has it); a new one is not
    expect(candidateExtras(`interface P { x: number }\nexport function f(p: P): number { return p.x; }`, 'f', `interface P { x: number }\nexport function f(p: P): number { return p.x; }`)).toEqual([]);
    expect(candidateExtras(`type Q = number;\nexport function f(n: Q): number { return n; }`, 'f', `export function f(n: number): number { return n; }`)).toEqual(['Q']);
    expect(candidateExtras(`export function f(n: number): number { const K = 3; return n + K; }`, 'f', `export function f(n: number): number { return n + 3; }`)).toEqual([]);

    const repo = await repoWith('src/k.ts', `const K = 7;\nexport function f(n: number): number {\n  return (n + K) / 2;\n}\n`);
    const extra = `const K = 3;\nexport function f(n: number): number {\n  return (n + K + 4) / 2;\n}`;
    const bin = await scripted([{ source: extra, idea: 'copied K' }]);
    const rt = new SessionRuntime({ repoRoot: repo, codex: new CodexClient({ ...resolveConfig({}), codexBin: bin, codexTimeoutMs: 30_000 }) });
    try {
      await rt.openFunction('src/k.ts', 'f');
      await rt.startTestedOnly();
      await new TestedOptimizer(rt, { threshold: { kind: 'time-budget', minutes: 5 }, noNewRounds: 1, maxRounds: 2, differentialInputs: 50, bench: { trials: 5, minTrialMs: 2 } }).run();
      const c = rt.state.optimize.candidates[0]!;
      expect(c.outcome).toBe('rejected');
      expect(c.rejection).toMatchObject({ stage: 'compile', kind: 'compile-error' });
      expect(c.rejection?.reason).toMatch(/^it declares K outside the function; only the function is delivered into your file/);
    } finally {
      await rt.close();
    }
  }, 120_000);

  it('GET /api/tested/check answers the preflight; POST /api/tested/start then fails with the same reason and no tested.started', async () => {
    const repo = await repoWith('src/z.ts', `import { scale } from './scale';\n${AVERAGE_TS.replace('return sum / xs.length;', 'return scale(sum) / xs.length;')}`);
    const api = await createApi(repo);
    const check = api.routes['GET /api/tested/check']!;
    const url = new URL('http://x/api/tested/check');
    try {
      await expect(check({ body: undefined, url, repoRoot: repo })).rejects.toThrow(/open a function first/);
      await api.runtime.openFunction('src/z.ts', 'average');
      const r = (await check({ body: undefined, url, repoRoot: repo })) as { ok: boolean; reason?: string };
      expect(r.ok).toBe(false);
      expect(r.reason).toMatch(/^average cannot run on its own: it uses scale, imported from '\.\/scale' \(line 14, column 10\)\./);
      await api.routes['POST /api/tested/start']!({ body: { threshold: { kind: 'time-budget', minutes: 1 } }, url, repoRoot: repo });
      for (let i = 0; i < 250 && !api.runtime.state.job.lastError; i++) await new Promise((res) => setTimeout(res, 20));
      expect(api.runtime.state.job.lastError).toEqual({ job: 'tested', message: r.reason });
      expect(api.runtime.events.some((e) => e.event.kind === 'tested.started')).toBe(false);

      await writeFile(join(repo, 'src/z.ts'), AVERAGE_TS);
      await api.runtime.openFunction('src/z.ts', 'average');
      expect(await check({ body: undefined, url, repoRoot: repo })).toEqual({ ok: true });
    } finally {
      await api.close();
    }
  }, 120_000);

  it('the prompt states the opt-in specials and never mentions a spec', () => {
    const p = buildTestedPrompt({
      fn: 'f', original: '/** doc */\nexport function f(x: number): number { return x / 2; }', refusal: { code: 'float', reason: 'bare division' }, signature: 'f(x: number)',
      specials: true, incumbent: { source: 's', timing: '1 ms' }, distribution: 'D', round: 1, previous: null,
    });
    expect(p).toContain('NaN, Infinity, -Infinity and -0');
    expect(p).toContain('-0 and 0 are different');
    expect(p).toContain('/** doc */');
    expect(p).not.toMatch(/AGREED SPECIFICATION/);
  });
});
