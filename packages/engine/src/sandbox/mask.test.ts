/**
 * Host-side unit tests of mask.ts. `hardenRealm()` is never called here (it would break the test runner's realm);
 * the sandbox tests exercise it inside the worker. `installMask` snapshots this test file's realm.
 */
import { describe, expect, it } from 'vitest';
import { evalMasked, installMask, isFaithfulRangeViolation, isInvariantViolation, takeViolations } from './mask.js';

installMask({ watchGlobalKeys: true });

describe('evalMasked (host realm)', () => {
  it('runs pure code and supports recursion', () => {
    const f = evalMasked<(n: number) => number>('function f(n){ return n < 2 ? n : f(n-1) + f(n-2); }', 'f');
    expect(f(10)).toBe(55);
  });

  it('records traps as structured violations, also when swallowed', () => {
    takeViolations();
    const f = evalMasked<() => number>('function f(){ try { return Math.random(); } catch { return 0; } }', 'f');
    expect(f()).toBe(0);
    expect(takeViolations()).toEqual([{ kind: 'ambient', what: 'Math.random' }]);
    const g = evalMasked<() => unknown>('function g(){ return process.pid; }', 'g');
    let caught: unknown;
    try {
      g();
    } catch (e) {
      caught = e;
    }
    expect(isInvariantViolation(caught)).toBe(true);
    expect(takeViolations()).toEqual([{ kind: 'ambient', what: 'process' }]);
  });

  it('detects, records and restores a modified intrinsic', () => {
    takeViolations();
    const real = Object.is;
    evalMasked<() => number>('function f(){ Object.is = () => true; return 0; }', 'f')();
    expect(takeViolations()).toEqual([{ kind: 'intrinsic', what: 'modified Object.is' }]);
    expect(Object.is).toBe(real);
    expect(takeViolations()).toEqual([]);
  });

  it('detects and removes a key added to the global object', () => {
    takeViolations();
    (globalThis as Record<string, unknown>).__faithfulLeak = 1;
    expect(takeViolations()).toEqual([{ kind: 'global-write', what: 'added global __faithfulLeak' }]);
    expect('__faithfulLeak' in globalThis).toBe(false);
  });

  it('injects the range helpers only in instrumented mode', () => {
    const src = 'function f(a, b){ __faithfulCheck(b !== 0, "b != 0"); return __faithfulInt(a * b, "a * b"); }';
    const f = evalMasked<(a: number, b: number) => number>(src, 'f', { instrumented: true });
    expect(f(3, 4)).toBe(12);
    expect(f(2 ** 26, 2 ** 27)).toBe(2 ** 53); // the bound itself is in range
    let e: unknown;
    try {
      f(2 ** 27, 2 ** 27);
    } catch (x) {
      e = x;
    }
    expect(isFaithfulRangeViolation(e)).toBe(true);
    expect((e as Error).message).toBe(`a * b is not an integer within +-2^53 (got ${2 ** 54})`);
    expect(() => f(1, 0)).toThrow('b != 0');
    expect(() => evalMasked<(a: number, b: number) => number>(src, 'f')(1, 1)).toThrow(ReferenceError);
  });

  it('rejects an invalid export name and a missing function', () => {
    expect(() => evalMasked('', 'a b')).toThrow(/invalid function name/);
    expect(() => evalMasked('function g(){}', 'f')).toThrow(/not defined/);
  });
});
