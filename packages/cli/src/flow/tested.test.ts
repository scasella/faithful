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
import { SessionRuntime } from './runtime.js';
import { TestedOptimizer, buildTestedPrompt, deliverTested } from './tested.js';
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
      expect(prov.testedOnly).toMatchObject({ refusal: { code: 'float' }, generator: { kind: 'signature', n: 400, specials: false } });
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
      expect(rep.checks.map((c) => c.name)).toEqual(['original source hash', 'optimized source hash', 'patch hash', 'claims', 'signature', 'differential']);
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
