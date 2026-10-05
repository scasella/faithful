import { chmod, mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { resolveConfig, resolveLeanDir } from '@faithful/core';
import { translate, type Translation } from '@faithful/translate';
import { CodexClient, checkLean } from '@faithful/prover';
import type { StageResult } from '@faithful/session';
import { SessionRuntime } from './runtime.js';
import { candidateTheorem, combineProof, jsLengthFacts, originalProofContext, proveCandidate, translateCandidate } from './candidateProof.js';
import { candidateGuideText } from './candidateGuide.js';

const hasLean = !process.env.FAITHFUL_SKIP_LEAN && resolveLeanDir() !== null;

const DBL_TS = 'export function dbl(x: number): number {\n  return x + x;\n}\n';
const DBL_CAND = 'export function dbl(x: number): number {\n  return 2 * x;\n}\n';
const SPEC = { lean: 'namespace Spec\ndef spec (x : Int) : Int := 2 * x\nend Spec', lines: [], properties: [], english: 'Twice x.' };
const ORIGINAL_PROOF = { helpers: '', proof: 'by\n  intro x _\n  simp [Model.dbl, Spec.spec]\n  ring', reasoning: 'x + x = 2 * x' };
const EQ_PROOF = { helpers: '', proof: 'by\n  intro x _\n  simp [Model.dbl_cand, Spec.spec]', reasoning: 'definitional' };
const RANGE_PROOF = {
  helpers: '',
  proof: 'by\n  intro x h1\n  simp [Model.dbl_pre, Model.dbl_rangeOk, Model.dbl_chk, Model.dbl_cand_pre, Model.dbl_cand_rangeOk, Model.dbl_cand_chk] at h1 ⊢\n  omega',
  reasoning: '2 * x is x + x, which the original checks',
};
const BAD_RANGE = { helpers: '', proof: 'by\n  intro x h1\n  simp [Model.dbl_cand_pre]', reasoning: 'too weak' };

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

describe('candidate theorem text (pure)', () => {
  const t = translate(DBL_TS, 'dbl') as Translation;
  const ct = translateCandidate(t, DBL_CAND) as Translation;
  it('states range and equality over the original\'s preconditions', () => {
    const th = candidateTheorem(t, ct, [], 3);
    expect(th.theoremName).toBe('candidate_3_meets_spec');
    expect(th.statement).toBe('∀ (x : Int), Model.dbl_pre x = true → Model.dbl_cand_pre x = true ∧ Model.dbl_cand x = Spec.spec x');
    expect(combineProof(th, 'R', 'E')).toBe('by\n  intro x h_c1\n  exact ⟨R x h_c1, E x h_c1⟩');
  });
  it('optional JavaScript length facts: arrays at most 2^32 - 1 elements, strings at most 2^53 - 1 code units', () => {
    const at = translate('export function f(xs: number[], s: string): number {\n  return xs.length + s.length;\n}\n', 'f') as Translation;
    const act = translateCandidate(at, 'export function f(xs: number[], s: string): number {\n  return s.length + xs.length;\n}\n') as Translation;
    expect(jsLengthFacts(at, ['xs', 's'])).toEqual(['(xs.length : Int) ≤ 4294967295', '(s.length : Int) ≤ 9007199254740991']);
    const th = candidateTheorem(at, act, [], 1, { lengthFacts: true });
    expect(th.statement).toBe('∀ (xs : List (Int)) (s : List Char), Model.f_pre xs s = true → (xs.length : Int) ≤ 4294967295 → (s.length : Int) ≤ 9007199254740991 → Model.f_cand_pre xs s = true ∧ Model.f_cand xs s = Spec.spec xs s');
    expect(combineProof(th, 'R', 'E')).toContain('intro xs s h_c1 h_c2 h_c3');
    expect(candidateTheorem(at, act, [], 1).lengthFacts).toBe(false);
  });
  it('the original\'s accepted proof becomes context text', () => {
    expect(originalProofContext({ statement: 'S', helpers: 'theorem a : True := trivial', proof: 'by\n  simp' })).toBe('theorem a : True := trivial\n\ntheorem original_meets_spec : S :=\nby\n  simp');
    expect(originalProofContext(null)).toBe('');
  });
  it('the guide describes the obligation of each part', () => {
    const th = candidateTheorem(t, ct, [], 1);
    expect(candidateGuideText('range', th)).toMatch(/range/i);
    expect(candidateGuideText('equality', th)).toMatch(/equal/i);
  });
});

async function session(answers: unknown[]) {
  const repo = await mkdtemp(join(tmpdir(), 'faithful-repo-'));
  await mkdir(join(repo, 'src'));
  await writeFile(join(repo, 'src/dbl.ts'), DBL_TS);
  const bin = await scripted(answers);
  const rt = new SessionRuntime({ repoRoot: repo, codex: new CodexClient({ ...resolveConfig({}), codexBin: bin, codexTimeoutMs: 30_000 }) });
  await rt.openFunction('src/dbl.ts', 'dbl');
  await rt.proposeSpec();
  await rt.agree();
  const pv = await rt.proveOriginal({ maxAttempts: 1, minutes: 5 });
  expect(pv.result).toBe('proved');
  return rt;
}

describe.skipIf(!hasLean)('candidate proofs (scripted model, real Lean)', () => {
  it('split mode: equality and range proved separately, combined mechanically, each emitted under its own theorem id', async () => {
    const rt = await session([SPEC, ORIGINAL_PROOF, EQ_PROOF, RANGE_PROOF]);
    try {
      const stages: StageResult[] = [];
      const ref = rt.state.proofs.find((p) => p.theoremId === 'original_meets_spec')!;
      const r = await proveCandidate(rt, {
        source: DBL_CAND, id: 2, mode: 'split', budget: { maxAttempts: 4, minutes: 5 },
        reference: { statement: ref.statement, helpers: ref.accepted!.helpers, proof: ref.accepted!.proof },
        done: async (s) => { stages.push(s); return s; },
      });
      expect(r.proved).toBe(true);
      expect(r.tier).toBe('proved');
      const ids = rt.state.proofs.map((p) => p.theoremId);
      expect(ids).toEqual(['original_meets_spec', 'candidate_2_equals_spec', 'candidate_2_range_ok', 'candidate_2_meets_spec']);
      const parts = rt.state.proofs.filter((p) => p.parent === 'candidate_2_meets_spec');
      expect(parts.map((p) => p.result)).toEqual(['proved', 'proved']);
      const whole = rt.state.proofs.find((p) => p.theoremId === 'candidate_2_meets_spec')!;
      expect(whole.parts).toEqual(['candidate_2_equals_spec', 'candidate_2_range_ok']);
      // the combined theorem is the unchanged statement, checked by the same checker; the combination is not a model call
      expect(whole.statement).toBe('∀ (x : Int), Model.dbl_pre x = true → Model.dbl_cand_pre x = true ∧ Model.dbl_cand x = Spec.spec x');
      expect(whole.attempts).toHaveLength(1);
      expect(whole.attempts[0]!.callId).toBeNull();
      expect(whole.accepted?.axioms.every((a) => ['propext', 'Classical.choice', 'Quot.sound'].includes(a))).toBe(true);
      expect(whole.accepted?.source).toContain('theorem original_meets_spec');
      const st = stages.at(-1)!;
      expect(st.status).toBe('pass');
      const d = st.detail as Record<string, any>;
      expect(d.theoremId).toBe('candidate_2_meets_spec');
      expect(d.equality.result).toBe('proved');
      expect(d.range.result).toBe('proved');
      expect(d.accepted.helpers).toContain('theorem candidate_2_equals_spec');
      expect(d.accepted.helpers).toContain('theorem candidate_2_range_ok');
      expect(rt.state.calls.filter((c) => c.purpose === 'proof-attempt')).toHaveLength(3);
    } finally {
      await rt.close();
    }
  }, 600_000);

  it('split mode: a range part that does not check leaves the candidate not proved, and says which part failed', async () => {
    const rt = await session([SPEC, ORIGINAL_PROOF, EQ_PROOF, BAD_RANGE]);
    try {
      const stages: StageResult[] = [];
      const r = await proveCandidate(rt, { source: DBL_CAND, id: 1, mode: 'split', budget: { maxAttempts: 2, minutes: 5 }, done: async (s) => { stages.push(s); return s; } });
      expect(r.proved).toBe(false);
      expect(r.rejection?.reason).toMatch(/the equality part was proved, the range part was not/);
      expect(rt.state.proofs.find((p) => p.theoremId === 'candidate_1_range_ok')?.result).toBe('not-proved');
      expect(rt.state.proofs.find((p) => p.theoremId === 'candidate_1_meets_spec')).toBeUndefined();
      expect(stages.at(-1)!.status).toBe('fail');
    } finally {
      await rt.close();
    }
  }, 600_000);

  it('single mode proves the conjunction in one theorem', async () => {
    const whole = { helpers: '', proof: `by\n  intro x h1\n  refine ⟨?_, ?_⟩\n  · simp [Model.dbl_pre, Model.dbl_rangeOk, Model.dbl_chk, Model.dbl_cand_pre, Model.dbl_cand_rangeOk, Model.dbl_cand_chk] at h1 ⊢\n    omega\n  · simp [Model.dbl_cand, Spec.spec]`, reasoning: 'both' };
    const rt = await session([SPEC, ORIGINAL_PROOF, whole]);
    try {
      const r = await proveCandidate(rt, { source: DBL_CAND, id: 1, mode: 'single', budget: { maxAttempts: 1, minutes: 5 }, done: async (s) => s });
      expect(r.proved).toBe(true);
      expect(rt.state.proofs.map((p) => p.theoremId)).toEqual(['original_meets_spec', 'candidate_1_meets_spec']);
    } finally {
      await rt.close();
    }
  }, 600_000);
});

const SUMTO = 'export function sumTo(n: number): number {\n  let s = 0;\n  for (let i = 1; i <= n; i++) {\n    s = s + i;\n  }\n  return s;\n}\n';
const SUMTO_CAND = 'export function sumTo(n: number): number {\n  let s = 0;\n  let i = n;\n  while (i > 0) {\n    s = s + i;\n    i = i - 1;\n  }\n  return s;\n}\n';

describe.skipIf(!hasLean)('the candidate guide\'s worked example (real Lean)', () => {
  it('compiles verbatim against the translator\'s models of the synthetic example, with no sorry and standard axioms', async () => {
    const t = translate(SUMTO, 'sumTo') as Translation;
    const ct = translateCandidate(t, SUMTO_CAND) as Translation;
    const th = candidateTheorem(t, ct, [], 1);
    const text = candidateGuideText('whole', th);
    const blocks: string[][] = [];
    let cur: string[] | null = null;
    for (const line of text.split('\n')) {
      if (/^    theorem/.test(line)) { cur = []; blocks.push(cur); }
      if (cur && /^    (theorem| )/.test(line)) cur.push(line.slice(4));
      else if (!/^    /.test(line)) cur = null;
    }
    expect(blocks.length).toBe(4);
    const spec = 'namespace Spec\ndef tri : Nat → Int\n  | 0 => 0\n  | k + 1 => tri k + (k + 1)\ndef spec (n : Int) : Int := tri n.toNat\nend Spec\ntheorem tri_nonneg (k : Nat) : 0 ≤ Spec.tri k := by\n  induction k with\n  | zero => simp [Spec.tri]\n  | succ k ih => simp only [Spec.tri]; omega\n';
    const src = th.modelSource.replace('import Faithful.Core', 'import Faithful.Tactics') + '\n' + spec + '\n' + blocks.map((b) => b.join('\n')).join('\n\n') +
      '\ntheorem eq_part : ∀ (n : Int), Model.sumTo_pre n = true → Model.sumTo_cand n = Spec.spec n := by\n  intro n _\n  simp only [Model.sumTo_cand, Spec.spec, cand_loop_eq]; omega\n';
    expect(src).not.toMatch(/sorry/);
    const r = await checkLean({ source: src, theorems: ['range_part', 'eq_part'], budgetMs: 180_000 });
    expect(r.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
    expect(r.axioms.range_part?.axioms.every((a) => ['propext', 'Classical.choice', 'Quot.sound'].includes(a))).toBe(true);
  }, 240_000);
});
