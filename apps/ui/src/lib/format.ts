/**
 * Number and value formatting. Rule: the tool never rounds up a claim.
 *  - A speedup point estimate and the lower CI bound are rounded DOWN, the upper bound UP, so the printed interval always
 *    contains the measured one and the headline never exceeds what was measured.
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

/** "4.2×" */
export function ratioText(s: Pick<Speedup, 'ratio'>): string {
  return `${floor1(s.ratio)}×`;
}
/** "95% CI 3.9–4.6" (the only percent sign the UI ever prints). */
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
