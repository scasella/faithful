import { describe, expect, it } from 'vitest';
import { StagnationTracker, attemptKey, diagnosticClass } from './stagnation.js';
import type { ProofCheck } from './proofFile.js';

const fail = (message: string, goal?: string): ProofCheck => ({
  verdict: { status: 'failed', reason: 'compile-error' },
  built: null, check: null, source: null,
  diagnostics: [{ file: 'f', line: 1, column: 0, endLine: 1, endColumn: 1, severity: 'error', message, kind: 'k', goal }],
});
const rejected = (r: string): ProofCheck => ({ verdict: { status: 'rejected', reasons: [r] }, built: null, check: null, source: null, diagnostics: [] });

describe('stagnation stop', () => {
  it('classifies the first diagnostic', () => {
    expect(diagnosticClass('unsolved goals\nx : Int\n⊢ x = x')).toBe('unsolved-goals');
    expect(diagnosticClass('`simp` made no progress')).toBe('no-progress');
    expect(diagnosticClass('omega could not prove the goal')).toBe('omega');
    expect(diagnosticClass('Type mismatch\n  h')).toBe('type-mismatch');
    expect(diagnosticClass('unknown identifier \'foo\'')).toBe('unknown-ident');
    expect(diagnosticClass('maximum recursion depth has been reached')).toBe('recursion-depth');
  });
  it('stops after 3 consecutive attempts with the same diagnostic and goal', () => {
    const t = new StagnationTracker();
    const g = 'x : Int\n⊢ f x = g x';
    expect(t.observe(fail('unsolved goals', g))).toBeNull();
    expect(t.observe(fail('unsolved goals', g))).toBeNull();
    expect(t.observe(fail('unsolved goals', g))).toMatch(/3 consecutive/);
  });
  it('does not stop when the goal changes (progress), even in the same class', () => {
    const t = new StagnationTracker();
    for (const g of ['⊢ a', '⊢ b', '⊢ a', '⊢ b', '⊢ a']) expect(t.observe(fail('unsolved goals', g))).toBeNull();
  });
  it('stops after two cheats (sorry) cumulatively, not one', () => {
    const t = new StagnationTracker();
    expect(t.observe(rejected('proof: sorry is not a proof'))).toBeNull();
    expect(t.observe(fail('unsolved goals', '⊢ a'))).toBeNull();
    expect(t.observe(rejected('helpers: sorry is not a proof'))).toMatch(/twice/);
  });
  it('keys on the goal, ignoring whitespace', () => {
    expect(attemptKey(fail('unsolved goals', 'a  :  Int\n⊢ x'))).toBe(attemptKey(fail('unsolved goals', 'a : Int ⊢ x')));
  });
});
