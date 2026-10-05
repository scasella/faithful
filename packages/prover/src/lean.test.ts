import { describe, expect, it } from 'vitest';
import { resolveLeanDir } from '@faithful/core';
import { checkLean, evalBatch, extractAxioms, goalOf, parseLeanJson } from './lean.js';

const hasLean = !process.env.FAITHFUL_SKIP_LEAN && resolveLeanDir() !== null;

describe('parseLeanJson / extractAxioms (pure)', () => {
  it('parses messages and classifies axiom sets', () => {
    const mk = (data: string, severity = 'information', line = 9) =>
      JSON.stringify({ data, severity, kind: 'k', fileName: 'x', pos: { line, column: 0 }, endPos: { line, column: 5 } });
    const out = [
      mk("'a' depends on axioms: [propext, Classical.choice, Quot.sound]"),
      mk("'b' does not depend on any axioms"),
      mk("'c' depends on axioms: [sorryAx]"),
      mk("'d' depends on axioms: [d._native.native_decide.ax_1_1]"),
      mk("'e' depends on axioms: [propext, Lean.ofReduceBool]"),
      mk("'f' depends on axioms: [myAxiom]"),
    ].join('\n');
    const ax = extractAxioms(parseLeanJson(out));
    expect(ax.a?.tier).toBe('proved');
    expect(ax.b?.tier).toBe('proved');
    expect(ax.c?.tier).toBeNull();
    expect(ax.d?.tier).toBe('proved-trusting-compiler');
    expect(ax.e?.tier).toBe('proved-trusting-compiler');
    expect(ax.f?.tier).toBeNull();
  });
  it('extracts a goal state from unsolved-goals text', () => {
    expect(goalOf('unsolved goals\na : ℤ\n⊢ a + 0 = a')).toBe('a : ℤ\n⊢ a + 0 = a');
    expect(goalOf('type mismatch')).toBeUndefined();
  });
});

describe.skipIf(!hasLean)('checkLean (real Lean)', () => {
  it('accepts a proof and reports axioms', async () => {
    const r = await checkLean({
      source: 'theorem t (a b : Nat) : a + b = b + a := by omega',
      theorems: ['t'],
      budgetMs: 60_000,
    });
    expect(r.ok).toBe(true);
    expect(r.axioms.t?.tier).toBe('proved');
    expect(r.leanVersion).toMatch(/Lean/);
  });
  it('reports a failed proof with its goal state', async () => {
    const r = await checkLean({ source: 'theorem t (a : Int) : a + 0 = a := by\n  skip\n', theorems: ['t'], budgetMs: 60_000 });
    expect(r.ok).toBe(false);
    const e = r.diagnostics.find((d) => d.severity === 'error');
    expect(e?.line).toBe(1);
    expect(e?.goal).toContain('⊢ a + 0 = a');
  });
  it('does not count sorry or native_decide as Proved', async () => {
    const r = await checkLean({
      source: 'theorem s : 2 = 2 := sorry\ntheorem n : 1 = 1 := by native_decide',
      theorems: ['s', 'n'],
      budgetMs: 60_000,
    });
    expect(r.axioms.s?.tier).toBeNull();
    expect(r.axioms.n?.tier).toBe('proved-trusting-compiler');
  });
  it('kills a runaway elaboration at the wall-clock budget', async () => {
    const t0 = Date.now();
    const r = await checkLean({
      source: 'partial def loop (n : Nat) : Nat := loop (n + 1)\n#eval loop 0',
      budgetMs: 3_000,
    });
    expect(r.timedOut).toBe(true);
    expect(r.ok).toBe(false);
    expect(Date.now() - t0).toBeLessThan(15_000);
  });
  it('batches #eval outputs by expression', async () => {
    const r = await evalBatch('def f (x : Int) : Int := x * 2', ['f 3', 'f (-4)', '(7 : Int) % 3'], { budgetMs: 60_000 });
    expect(r.outputs).toEqual(['6', '-8', '1']);
  });
});
