import { describe, expect, it } from 'vitest';
import { resolveLeanDir } from '@faithful/core';
import { buildProofFile, checkProof, vetProofText, type ProofTarget } from './proofFile.js';

const hasLean = !process.env.FAITHFUL_SKIP_LEAN && resolveLeanDir() !== null;

const target: ProofTarget = {
  modelSource: 'namespace Model\ndef original (x : Int) : Int := x + x\ndef pre (x : Int) : Bool := decide (-100 ≤ x ∧ x ≤ 100)\nend Model\n',
  specSource: 'namespace Spec\ndef spec (x : Int) : Int := 2 * x\nend Spec\n',
  theoremName: 'original_meets_spec',
  statement: '∀ (x : Int), Model.pre x = true → Model.original x = Spec.spec x',
  tacticImports: [],
};

describe('vetProofText', () => {
  it('refuses text that could change meaning or add trust', () => {
    for (const bad of ['sorry', 'by\n  admit', 'axiom foo : False', 'notation "a" => 1', 'open Nat in', 'unsafe def f := 1', '#eval 1', 'instance : Add Int := ⟨fun _ _ => 0⟩', 'set_option pp.all true']) {
      expect(vetProofText({ helpers: '', proof: 'by simp' }).length).toBe(0);
      expect(vetProofText({ helpers: bad, proof: 'by simp' }).length, bad).toBeGreaterThan(0);
    }
  });
  it('ignores forbidden words inside comments and allows heartbeat options', () => {
    expect(vetProofText({ helpers: '-- no sorry here\n/- axiom -/ set_option maxHeartbeats 400000 in\ntheorem a : 1 = 1 := rfl', proof: 'by omega' })).toEqual([]);
  });
});

describe('buildProofFile', () => {
  it('places already-checked context after the spec and before the helpers', () => {
    const b = buildProofFile({ ...target, context: 'theorem prior : 1 = 1 := rfl' }, { helpers: 'theorem h : 2 = 2 := rfl', proof: 'by simp' });
    const s = b.source;
    expect(s.indexOf('def spec')).toBeLessThan(s.indexOf('theorem prior'));
    expect(s.indexOf('theorem prior')).toBeLessThan(s.indexOf('theorem h :'));
    // the fingerprint file carries the same context
    expect(buildProofFile({ ...target, context: 'theorem prior : 1 = 1 := rfl' }, 'sorry').source).toContain('theorem prior');
  });
  it('puts the statement ours and the proof after :=', () => {
    const b = buildProofFile(target, { helpers: 'theorem h : 1 = 1 := rfl', proof: 'by\n  intro x _\n  simp [Model.original, Spec.spec]\n  omega' });
    expect(b.source).toContain('theorem original_meets_spec : ∀ (x : Int), Model.pre x = true → Model.original x = Spec.spec x :=');
    expect(b.source.split('\n')[b.theoremLine - 1]).toContain('theorem original_meets_spec');
  });
});

describe.skipIf(!hasLean)('checkProof (real Lean)', () => {
  const opts = { budgetMs: 60_000 };
  it('accepts a real proof with allowed axioms', async () => {
    const r = await checkProof(target, { helpers: '', proof: 'by\n  intro x _\n  simp [Model.original, Spec.spec]\n  omega' }, opts);
    expect(r.verdict).toMatchObject({ status: 'proved', tier: 'proved' });
  });
  it('reports a failed proof with the goal state', async () => {
    const r = await checkProof(target, { helpers: '', proof: 'by\n  intro x _\n  skip' }, opts);
    expect(r.verdict).toMatchObject({ status: 'failed', reason: 'compile-error' });
    expect(r.diagnostics[0]?.goal).toContain('⊢');
  });
  it('labels native_decide as trusting the compiler', async () => {
    const t: ProofTarget = { ...target, statement: 'Model.original 3 = Spec.spec 3' };
    const r = await checkProof(t, { helpers: '', proof: 'by native_decide' }, opts);
    expect(r.verdict).toMatchObject({ status: 'proved', tier: 'proved-trusting-compiler' });
  });
  it('rejects a proof whose helper redefines meaning (statement fingerprint) or adds an axiom', async () => {
    const r = await checkProof(target, { helpers: 'theorem fake : False := sorry', proof: 'by simp' }, opts);
    expect(r.verdict.status).toBe('rejected');
  });
  it('does not accept a proof that smuggles an axiom through a declaration the vetting misses', async () => {
    // `Classical.choice` alone is fine; a hidden `sorryAx` use must not be.
    const r = await checkProof(target, { helpers: '', proof: 'sorryAx _ false' }, opts);
    expect(r.verdict.status).not.toBe('proved');
  });
});
