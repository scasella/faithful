/**
 * Number and value formatting. Rule: the tool never rounds up a claim.
 *  - A speedup point estimate and the lower CI bound are rounded DOWN, the upper bound UP, so the printed interval always
 *    contains the measured one and the headline never exceeds what was measured.
 *  - A speedup near 1 gets enough decimals that a "faster" interval never prints a lower bound of 1.0 or below
 *    (`speedupDecimals`); when no such printing exists the claim is not "faster" (`canSayFaster`).
 *  - Durations are whole milliseconds (or minutes with one decimal) and are timings, not claims.
 */
import type { Outcome, Val } from '@faithful/translate';
import type { Speedup } from '@faithful/session';
import { formatCount } from '@faithful/core/tiers';

const EPS = 1e-9;

export function floor1(x: number): string {
  return (Math.floor(x * 10 + EPS) / 10).toFixed(1);
}
export function ceil1(x: number): string {
  return (Math.ceil(x * 10 - EPS) / 10).toFixed(1);
}

/** x rounded DOWN to d decimals (a lower bound or a point estimate is never shown larger than measured). */
export function floorN(x: number, d: number): string {
  const f = 10 ** d;
  return (Math.floor(x * f + EPS) / f).toFixed(d);
}
/** x rounded UP to d decimals (an upper bound is never shown smaller than measured). */
export function ceilN(x: number, d: number): string {
  const f = 10 ** d;
  return (Math.ceil(x * f - EPS) / f).toFixed(d);
}

const MAX_DECIMALS = 6;

type SpeedupLike = Pick<Speedup, 'ratio' | 'lo' | 'hi'> & { significant?: boolean };

/**
 * Decimals for a speedup ratio and its interval, so the printed interval never contradicts the verdict:
 * one decimal when the ratio is more than 0.5 away from 1, at least two when it is within 0.5 of 1, and more until a
 * "faster" lower bound prints above 1 (rounded down, so it never reads as more than was measured).
 * Returns null when the claim is "faster" but the lower bound is not above 1 (or prints as 1 even at six decimals):
 * the caller must then not say "faster".
 */
export function speedupDecimals(s: Pick<Speedup, 'ratio' | 'lo' | 'hi'>, faster: boolean): number | null {
  let d = Math.abs(s.ratio - 1) <= 0.5 ? 2 : 1;
  if (!faster) return d;
  if (!(s.lo > 1)) return null;
  while (d <= MAX_DECIMALS && Number(floorN(s.lo, d)) <= 1) d++;
  return d <= MAX_DECIMALS ? d : null;
}

/** True when a speedup may be printed as "faster": significant and its interval, as printed, lies above 1. */
export function canSayFaster(s: SpeedupLike): boolean {
  return s.significant === true && speedupDecimals(s, true) !== null;
}

/** "4.2×", or "1.08×" near 1: the point estimate rounded down, with the same decimals as its interval. */
export function ratioText(s: SpeedupLike): string {
  const d = speedupDecimals(s, s.significant === true) ?? speedupDecimals(s, false)!;
  return `${floorN(s.ratio, d)}×`;
}
/** "95% CI 1.04–1.12" for a speedup: lower bound rounded down, upper rounded up, same decimals as `ratioText`. */
export function speedupCiText(s: SpeedupLike): string {
  const d = speedupDecimals(s, s.significant === true) ?? speedupDecimals(s, false)!;
  return `95% CI ${floorN(s.lo, d)}–${ceilN(s.hi, d)}`;
}
/** "95% CI 3.9–4.6" (the only percent sign the UI ever prints). One decimal, rounded outward; for timings. */
export function ciText(lo: number, hi: number): string {
  return `95% CI ${floor1(lo)}–${ceil1(hi)}`;
}

export function msText(ms: number): string {
  if (ms < 1) return '<1 ms';
  if (ms < 60_000) return `${formatCount(Math.round(ms))} ms`;
  return `${(Math.round(ms / 6_000) / 10).toFixed(1)} min`;
}

export function nsText(ns: number): string {
  return `${floor1(ns)} ns/pass`;
}

/** Exact, compact text of a value in the value domain. Strings are JSON-quoted; null is the option `none`. */
export function valText(v: Val): string {
  if (v === null) return 'null';
  // NaN, Infinity, -Infinity, -0 and undefined travel as { "$faithful": name } (Tested-only path; engine jsvalues.ts)
  if (typeof v === 'object' && !Array.isArray(v)) {
    const keys = Object.keys(v);
    const n = keys.length === 1 && keys[0] === '$faithful' ? v.$faithful : null;
    if (n === 'NaN' || n === 'Infinity' || n === '-Infinity' || n === '-0' || n === 'undefined') return n;
  }
  if (typeof v === 'string') return JSON.stringify(v);
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (Array.isArray(v)) return `[${v.map(valText).join(', ')}]`;
  return `{ ${Object.entries(v)
    .map(([k, x]) => `${k}: ${valText(x)}`)
    .join(', ')} }`;
}

/** Plain-words verb phrase: "returns 2", "throws \"empty\"", "faults (timeout)". */
export function outcomeVerb(o: Outcome): string {
  switch (o.tag) {
    case 'ok':
      return `returns ${valText(o.value)}`;
    case 'throw':
      return `throws ${JSON.stringify(o.message)}`;
    case 'range-violation':
      return `leaves the integer range (${o.detail})`;
    case 'fault':
      return `faults (${o.detail})`;
  }
}

export function outcomeEqual(a: Outcome, b: Outcome): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** "n = 2" or "xs = [1, 2], k = 3"; positional "(2)" when parameter names are unknown. */
export function inputText(input: Val[], names: string[] | null): string {
  if (names && names.length === input.length) return input.map((v, i) => `${names[i]} = ${valText(v)}`).join(', ');
  return `(${input.map(valText).join(', ')})`;
}
