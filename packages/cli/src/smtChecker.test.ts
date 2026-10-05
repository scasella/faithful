import { describe, expect, it } from 'vitest';
import { translate, type Translation } from '@faithful/translate';
import { openZ3 } from '@faithful/smt';
import { smtChecker } from './smtChecker.js';

const FIB = `export function fib(n: number): number {\n  if (n < 2) { return n; }\n  return fib(n - 1) + fib(n - 2);\n}\n`;
const GOOD = `export function fib(n: number): number {\n  if (n < 2) { return n; }\n  let a = 0; let b = 1;\n  for (let i = 0; i < n; i++) { const t = a + b; a = b; b = t; }\n  return a;\n}\n`;
const BAD = `export function fib(n: number): number {\n  if (n <= 2) { return 1; }\n  let a = 1; let b = 1;\n  for (let i = 3; i <= n; i++) { const t = a + b; a = b; b = t; }\n  return b;\n}\n`;

describe('smtChecker (real Z3)', () => {
  it('verifies a correct candidate and finds a replay-confirmed counterexample for a wrong one', async () => {
    const z3 = await openZ3();
    const t = translate(FIB, 'fib') as Translation;
    const chk = smtChecker(z3);
    const good = await chk.check(t, FIB, GOOD, 'fib', { budgetMs: 60_000 });
    expect(good.status).toBe('verified');
    const bad = await chk.check(t, FIB, BAD, 'fib', { budgetMs: 60_000 });
    expect(bad.status).toBe('counterexample');
    // original and candidate differ on the reported input (replayed in the sandbox)
    expect(bad.counterexample?.original).not.toEqual(bad.counterexample?.candidate);
    // the first draft of the correct candidate forgot that fib(n) = n for negative n: Z3 found it
    const forgot = await chk.check(t, FIB, GOOD.replace('  if (n < 2) { return n; }\n', ''), 'fib', { budgetMs: 60_000 });
    expect(forgot.status).toBe('counterexample');
    expect(forgot.counterexample?.input).toEqual([-1]);
  }, 180_000);
});
