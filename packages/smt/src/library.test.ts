/**
 * Sanity mode on purpose-built functions for the library operations the corpus does not exercise (or exercises only
 * with literal arguments): every encoding is checked against the instrumented original on generated inputs, plus the
 * uniqueness pass. Any mismatch is an encoder bug.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Sandbox, liveSandboxWorkers } from '@faithful/engine';
import { translateWithIr } from '@faithful/translate';
import { sanityCheck } from './sanity.js';
import { openZ3, type Z3Driver } from './z3.js';

const FIXTURES: Array<[string, string]> = [
  ['intToStr', `export function f(n: number, b: boolean): string { return \`\${n}|\${b}|\` + (n - 7); }`],
  ['split with a symbolic separator', `export function f(s: string, sep: string): string[] { return s.split(sep); }`],
  ['split then join, literal separators', `export function f(s: string): string { return s.split("ab").join("-"); }`],
  ['string comparisons', `export function f(a: string, b: string): number[] { return [a < b ? 1 : 0, a <= b ? 1 : 0, a > b ? 1 : 0, a >= b ? 1 : 0, a === b ? 1 : 0]; }`],
  ['sort by string key, descending', `export function f(xs: { k: string; v: number }[]): { k: string; v: number }[] { return xs.slice().sort((a, b) => (a.k < b.k ? 1 : a.k > b.k ? -1 : 0)); }`],
  ['plain sort of strings', `export function f(xs: string[]): string[] { return xs.slice().sort(); }`],
  ['index callbacks', `export function f(xs: number[]): number { const ys = xs.map((x, i) => x * i).filter((y, i) => y > i); return ys.reduce((acc, y, i) => acc + y - i, 0); }`],
  ['indexOf / includes on strings', `export function f(xs: string[], x: string): number { return xs.indexOf(x) + (xs.includes(x + "a") ? 100 : 0); }`],
  ['join numbers and booleans', `export function f(xs: number[], bs: boolean[]): string { return xs.join() + "/" + bs.join(" "); }`],
  ['negative slice indices', `export function f(xs: number[], a: number, b: number): number[] { return xs.slice(a, b).concat(xs.slice(-a)); }`],
  ['string slice and indexOf with position', `export function f(s: string, t: string, p: number): string { return s.slice(p, -1) + s.indexOf(t, p); }`],
  ['charCodeAt and strAt', `export function f(s: string, i: number): number { return s.charCodeAt(i) + s[i].length; }`],
  ['case maps', `export function f(s: string): string { return s.toUpperCase() + s.toLowerCase(); }`],
  ['Math.ceil division and abs/min/max', `export function f(a: number, b: number): number { return Math.ceil(a / b) + Math.abs(a) - Math.min(a, b, 3) + Math.max(a, b); }`],
  ['option result', `export function f(xs: number[]): number | null { for (const x of xs) { if (x > 3) { return x; } } return null; }`],
  ['tuples', `export function f(a: number, b: number): [number, string] { return [a % b, \`\${a}\`]; }`],
  ['recursion depth bookkeeping', `export function f(n: number): number { if (n <= 0) { return 0; } return 1 + f(n - 1); }`],
];

let z3: Z3Driver;
let sandbox: Sandbox;
beforeAll(async () => {
  z3 = await openZ3('system');
  sandbox = await Sandbox.open();
});
afterAll(async () => {
  await sandbox?.close();
  expect(liveSandboxWorkers()).toBe(0);
});

describe('encoder sanity on library operations', () => {
  it.each(FIXTURES)('%s', async (_name, src) => {
    const w = translateWithIr(src, 'f');
    if (!w.result.ok || !w.ir) throw new Error(`fixture not translated: ${JSON.stringify(w.result)}`);
    const r = await sanityCheck(w.result, w.ir, z3, { n: 60, sandbox, unroll: 12 });
    expect(r.encodable, r.unsupported.join('; ')).toBe(true);
    expect(r.mismatches).toEqual([]);
    expect(r.solverMissing).toBe(0);
    expect(r.compared).toBeGreaterThanOrEqual(30);
    expect(r.uniquenessChecked).toBe(r.inputs);
  }, 300_000);
});
