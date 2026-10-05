import { describe, expect, it } from 'vitest';
import { openSystemZ3, openWasmZ3, openZ3 } from './z3.js';

const SAT = '(declare-const x Int)(assert (= (* x x) 49))(assert (> x 0))(check-sat)(get-value (x))';
const UNSAT = '(declare-const x Int)(assert (> x 3))(assert (< x 2))(check-sat)';
// A query that cannot finish quickly: nonlinear integer reasoning over a hard factoring-style constraint.
const HARD =
  '(declare-const a Int)(declare-const b Int)(assert (> a 1))(assert (> b 1))' +
  '(assert (= (* a b) 340282366920938463463374607431768211457))(check-sat)';

describe.each([
  ['wasm', openWasmZ3],
  ['system', openSystemZ3],
] as const)('z3 driver (%s)', (kind, open) => {
  it('solves sat and unsat and returns a model', async () => {
    const z = await open();
    if (!z) return; // not installed here; doctor reports it
    expect(z.kind).toBe(kind);
    const s = await z.solve(SAT, { timeoutMs: 20_000 });
    expect(s.status).toBe('sat');
    expect(s.output).toMatch(/7/);
    expect((await z.solve(UNSAT, { timeoutMs: 20_000 })).status).toBe('unsat');
  });
  it('enforces the wall-clock budget', async () => {
    const z = await open();
    if (!z) return;
    const t0 = Date.now();
    const r = await z.solve(HARD, { timeoutMs: 1_500 });
    expect(['timeout', 'unknown']).toContain(r.status);
    expect(Date.now() - t0).toBeLessThan(8_000);
  });
});

describe('openZ3', () => {
  it('prefers WASM and reports which driver ran', async () => {
    const z = await openZ3();
    expect(['wasm', 'system']).toContain(z.kind);
    expect(z.version).not.toBe('');
  });
});
