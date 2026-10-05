/** The fixtures are invented, but they must be internally consistent: a reader can check them. */
import { describe, expect, it } from 'vitest';
import { replay } from '@faithful/session';
import { FIXTURES } from './index';
import { CANDIDATE_ITERATIVE, CANDIDATE_OFF_BY_ONE, CANDIDATE_TWO_STEP, FIB_SOURCE } from './catch';
import { AVERAGE_SOURCE } from './refused';

function load(src: string): (n: number) => number {
  const body = src.replace(/^\/\*\*.*\*\/\n/m, '').replace('export function', 'return function').replace(/: number/g, '');
  return new Function(body)() as (n: number) => number;
}

describe('fixtures', () => {
  it('are labelled as fixtures and replay to their final stage', () => {
    expect(replay(FIXTURES.catch!.events).stage).toBe('deliver');
    expect(replay(FIXTURES.refused!.events).stage).toBe('translate');
    for (const f of Object.values(FIXTURES)) expect(f.fixture).toBe(true);
  });

  it('events are numbered and timed monotonically', () => {
    for (const f of Object.values(FIXTURES))
      f.events.forEach((e, i) => {
        expect(e.seq).toBe(i);
        if (i > 0) expect(e.t).toBeGreaterThanOrEqual(f.events[i - 1]!.t);
      });
  });

  it('candidate 1 really differs from the original first at n = 2 (and only there for n in 0..30)', () => {
    const orig = load(FIB_SOURCE);
    const c1 = load(CANDIDATE_OFF_BY_ONE);
    const diffs = Array.from({ length: 31 }, (_, n) => n).filter((n) => orig(n) !== c1(n));
    expect(diffs).toEqual([2]);
    expect([orig(2), c1(2)]).toEqual([1, 2]);
    // ...and the declared distribution (n in 5..9) never draws it, which is why differential testing passed.
    expect(diffs.some((n) => n >= 5 && n <= 9)).toBe(false);
  });

  it('candidates 2 and 3 agree with the original on 0..30', () => {
    const orig = load(FIB_SOURCE);
    for (const src of [CANDIDATE_ITERATIVE, CANDIDATE_TWO_STEP]) {
      const f = load(src);
      for (let n = 0; n <= 30; n++) expect(f(n)).toBe(orig(n));
    }
  });

  it('the recorded counterexample matches running the sources', () => {
    const s = replay(FIXTURES.catch!.events);
    const r = s.optimize.candidates.find((c) => c.outcome === 'rejected')!.rejection!;
    const n = r.counterexample!.input[0] as number;
    expect(r.counterexample!.original).toEqual({ tag: 'ok', value: load(FIB_SOURCE)(n) });
    expect(r.counterexample!.candidate).toEqual({ tag: 'ok', value: load(CANDIDATE_OFF_BY_ONE)(n) });
  });

  it('the refusal span points at the division', () => {
    const s = replay(FIXTURES.refused!.events);
    if (!s.translation || s.translation.ok) throw new Error('expected a refusal');
    const sp = s.translation.refusal.span;
    expect(AVERAGE_SOURCE.slice(sp.start, sp.end)).toBe('sum / xs.length');
    expect(AVERAGE_SOURCE.split('\n')[sp.line - 1]!.slice(sp.column - 1)).toMatch(/^sum \/ xs\.length/);
  });

  it('range-ok words are true: fib(78) fits in 2^53 and fib(79) does not', () => {
    const f = load(CANDIDATE_ITERATIVE);
    expect(f(78)).toBeLessThanOrEqual(2 ** 53);
    expect(f(79)).toBeGreaterThan(2 ** 53);
  });
});
