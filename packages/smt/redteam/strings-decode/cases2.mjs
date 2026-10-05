/**
 * Red-team round 2, area strings-decode (packages/smt): fresh probe pairs (round 1's are in cases.mjs and are re-run
 * unchanged). Same format and same `kind` semantics as cases.mjs:
 *   'different'  sat, replayed outcomes differ, the encoder's predicted outcomes equal the replayed ones
 *   'equal'      unsat (the pair agrees on every input inside every listed bound; ground truth checks the first one)
 * `truth()` lies inside the FIRST bounds entry and is exhaustive over the stated alphabet / integer range (or lists the
 * analytic boundary points). `expectInput`: the only distinguishing input in the truth domain; the decoded
 * counterexample must equal it exactly.
 *
 * Families round 1 did not touch: number[].join (intToStr per element), String(n) compared as strings, split with a
 * separator derived from the input, compositions through indexOf's -1, reduce-built strings, slice() without
 * arguments, length-driven candidate overflow, records with `constructor`/`toString` fields, stable string-key sorts on
 * records, for...of over split parts, caesar shifts with %, mapI/filterI on split parts, extreme slice/indexOf
 * positions, strings with U+2028/U+FEFF/CR LF in decoded counterexamples, Option<string>.
 *
 * TypeScript sources use `%%` for a backtick and `#{` for a template-literal substitution (as in cases.mjs).
 */
import { arrs, ints, product, strs } from './cases.mjs';

const ts = (s, ...v) => String.raw(s, ...v).replaceAll('#{', '${').replaceAll('%%', '`');

const SMALL = { array: 2, string: 3, int: 4, unroll: 8 };
const MID = { array: 3, string: 3, int: 12, unroll: 8 };
const DEFAULT = { array: 6, string: 8, int: 2 ** 16, unroll: 10 };
const BIG = { array: 2, string: 2, int: 2 ** 53, unroll: 2 };
const AB = ['a', 'b'];
const P53 = 2 ** 53;

export const CASES2 = [
  // ═════════════ number[].join: intToStr per element ═════════════
  {
    id: 'r2-numjoin-vs-template-loop-equal',
    kind: 'equal',
    original: ts`export function f(xs: number[]): string { return xs.join(""); }`,
    candidate: ts`export function f(xs: number[]): string { let r = ""; for (const x of xs) { r = r + %%#{x}%%; } return r; }`,
    // at DEFAULT (arrays 6) Z3 times out after 120 s: `unknown`, honest; checked at arrays 2 and 3
    bounds: [SMALL, { array: 3, string: 3, int: 64, unroll: 6 }],
    truth: () => arrs(ints(-4, 4), 2).map((a) => [a]),
  },
  {
    id: 'r2-numjoin-abs-drops-sign',
    kind: 'different',
    original: ts`export function f(xs: number[]): string { return xs.join("-"); }`,
    candidate: ts`export function f(xs: number[]): string { return xs.map((x) => Math.abs(x)).join("-"); }`,
    // at DEFAULT and at arrays 3 / ints ±64 Z3 times out after 120 s (`unknown`, honest; never a claim); checked at SMALL
    bounds: [SMALL],
    truth: () => arrs(ints(-4, 4), 2).map((a) => [a]),
  },
  {
    id: 'r2-numjoin-default-sep-equal',
    kind: 'equal',
    original: ts`export function f(xs: number[]): string { return xs.join(); }`,
    candidate: ts`export function f(xs: number[]): string { return xs.map((x) => %%#{x}%%).join(","); }`,
    bounds: [SMALL, DEFAULT, BIG],
    truth: () => arrs(ints(-4, 4), 2).map((a) => [a]),
  },
  {
    id: 'r2-numjoin-length-2^53',
    // the joined length differs from a digit count that forgets the 16th digit: only |x| >= 10^15 shows it
    kind: 'different',
    original: ts`export function f(xs: number[]): number { return xs.join("").length; }`,
    candidate: ts`export function f(xs: number[]): number { return xs.reduce((a, x) => a + Math.min(%%#{x}%%.length, 15 + (x < 0 ? 1 : 0)), 0); }`,
    bounds: [BIG],
    truth: () => arrs([0, -1, P53, -P53, P53 - 1, 1e15 - 1], 1).map((a) => [a]),
  },

  // ═════════════ String(n) compared as strings ═════════════
  {
    id: 'r2-numstr-lt-vs-num-lt',
    kind: 'different',
    original: ts`export function f(n: number, m: number): boolean { return %%#{n}%% < %%#{m}%%; }`,
    candidate: ts`export function f(n: number, m: number): boolean { return n < m; }`,
    bounds: [MID, DEFAULT],
    truth: () => product(ints(-12, 12), ints(-12, 12)),
  },
  {
    id: 'r2-numstr-lt-same-length-nonneg-equal',
    kind: 'equal',
    original: ts`export function f(n: number, m: number): boolean { return n >= 0 && m >= 0 && %%#{n}%%.length === %%#{m}%%.length ? %%#{n}%% < %%#{m}%% : n < m; }`,
    candidate: ts`export function f(n: number, m: number): boolean { return n < m; }`,
    bounds: [MID, DEFAULT],
    truth: () => product(ints(-12, 12), ints(-12, 12)),
  },
  {
    id: 'r2-numstr-first-char-minus-equal',
    kind: 'equal',
    original: ts`export function f(n: number): boolean { return %%#{n}%%.charCodeAt(0) === 45; }`,
    candidate: ts`export function f(n: number): boolean { return n < 0; }`,
    bounds: [MID, DEFAULT, BIG],
    truth: () => ints(-12, 12).map((n) => [n]),
  },
  {
    id: 'r2-numstr-indexOf-zero',
    // "has a zero digit" vs "divisible by 10": differ at 101-like numbers; inside ±12 only at 0 vs ... none, so ±2^16
    kind: 'different',
    original: ts`export function f(n: number): boolean { return %%#{n}%%.indexOf("0") >= 0; }`,
    candidate: ts`export function f(n: number): boolean { return n % 10 === 0; }`,
    bounds: [{ array: 1, string: 1, int: 120, unroll: 2 }, DEFAULT],
    truth: () => ints(-120, 120).map((n) => [n]),
  },

  // ═════════════ split with a separator derived from the input ═════════════
  {
    id: 'r2-split-self-count-equal',
    // s.split(s): "" -> [], otherwise ["", ""]
    kind: 'equal',
    original: ts`export function f(s: string): number { return s.split(s).length; }`,
    candidate: ts`export function f(s: string): number { return s.length === 0 ? 0 : 2; }`,
    bounds: [SMALL, DEFAULT],
    truth: () => strs(AB, 3).map((s) => [s]),
  },
  {
    id: 'r2-split-self-wrong-empty',
    kind: 'different',
    original: ts`export function f(s: string): number { return s.split(s).length; }`,
    candidate: ts`export function f(s: string): number { return 2; }`,
    bounds: [SMALL, DEFAULT],
    truth: () => strs(AB, 3).map((s) => [s]),
    expectInput: [''],
  },
  {
    id: 'r2-split-first-char-equal',
    kind: 'equal',
    original: ts`export function f(s: string): number { return s.split(s.slice(0, 1)).length; }`,
    candidate: ts`export function f(s: string): number { if (s.length === 0) { return 0; } let c = 0; for (let i = 0; i < s.length; i++) { if (s.charAt(i) === s.charAt(0)) { c = c + 1; } } return c + 1; }`,
    bounds: [SMALL, DEFAULT],
    truth: () => strs(AB, 3).map((s) => [s]),
  },
  {
    id: 'r2-split-tail-sep-different',
    // the separator is the last two units of s; overlapping matches are not counted
    kind: 'different',
    original: ts`export function f(s: string): number { return s.split(s.slice(-2)).length; }`,
    candidate: ts`export function f(s: string): number { return s.length < 2 ? (s.length === 0 ? 0 : 2) : 2; }`,
    // differs first at length 4: "abab".split("ab") is ["", "", ""]
    bounds: [{ array: 1, string: 4, int: 4, unroll: 8 }, DEFAULT],
    truth: () => strs(AB, 4).map((s) => [s]),
  },

  // ═════════════ compositions through indexOf's -1 ═════════════
  {
    id: 'r2-charAt-indexOf-notfound-equal',
    kind: 'equal',
    original: ts`export function f(s: string, t: string): string { return s.charAt(s.indexOf(t)); }`,
    candidate: ts`export function f(s: string, t: string): string { const i = s.indexOf(t); return i < 0 || i >= s.length ? "" : s.slice(i, i + 1); }`,
    bounds: [SMALL, DEFAULT],
    truth: () => product(strs(AB, 3), strs(AB, 2)),
  },
  {
    id: 'r2-slice-indexOf-notfound',
    // not found: slice(-1) is the last unit, not the whole string
    kind: 'different',
    original: ts`export function f(s: string): string { return s.slice(s.indexOf(",")); }`,
    candidate: ts`export function f(s: string): string { return s.indexOf(",") < 0 ? s : s.slice(s.indexOf(",")); }`,
    bounds: [SMALL, DEFAULT],
    truth: () => strs(['a', ','], 3).map((s) => [s]),
  },
  {
    id: 'r2-slice-indexOf-notfound-equal',
    kind: 'equal',
    original: ts`export function f(s: string): string { return s.slice(s.indexOf(",")); }`,
    candidate: ts`export function f(s: string): string { return s.indexOf(",") < 0 ? (s.length === 0 ? "" : s.charAt(s.length - 1)) : s.slice(s.indexOf(",")); }`,
    bounds: [SMALL, DEFAULT],
    truth: () => strs(['a', ','], 3).map((s) => [s]),
  },

  // ═════════════ reduce-built strings, slice() ═════════════
  {
    id: 'r2-reduce-concat-vs-join-equal',
    kind: 'equal',
    original: ts`export function f(xs: string[]): string { return xs.reduce((a, x) => a + x, ""); }`,
    candidate: ts`export function f(xs: string[]): string { return xs.join(""); }`,
    bounds: [SMALL, DEFAULT],
    truth: () => arrs(strs(AB, 2), 2).map((a) => [a]),
  },
  {
    id: 'r2-reduce-concat-reversed',
    kind: 'different',
    original: ts`export function f(xs: string[]): string { return xs.reduce((a, x) => a + x, ""); }`,
    candidate: ts`export function f(xs: string[]): string { return xs.reduce((a, x) => x + a, ""); }`,
    bounds: [SMALL, DEFAULT],
    truth: () => arrs(strs(AB, 1), 2).map((a) => [a]),
  },
  {
    id: 'r2-slice-no-args-equal',
    kind: 'equal',
    original: ts`export function f(s: string): string { return s.slice(); }`,
    candidate: ts`export function f(s: string): string { return s; }`,
    bounds: [SMALL, DEFAULT],
    truth: () => strs(AB, 3).map((s) => [s]),
  },

  // ═════════════ length-driven candidate overflow (hash) ═════════════
  {
    id: 'r2-hash-deferred-mod-overflow',
    // the original reduces every step; the candidate only at the end: with four units and a high first unit,
    // 65535 * 65536^3 > 2^53, so the candidate (only) leaves the model
    kind: 'different',
    original: ts`export function f(s: string): number { let h = 0; for (let i = 0; i < s.length; i++) { h = (h * 65536 + s.charCodeAt(i)) % 7; } return h; }`,
    candidate: ts`export function f(s: string): number { let h = 0; for (let i = 0; i < s.length; i++) { h = h * 65536 + s.charCodeAt(i); } return h % 7; }`,
    bounds: [{ array: 1, string: 4, int: 4, unroll: 6 }],
    truth: () => strs(['a', '￿'], 4).map((s) => [s]),
  },

  // ═════════════ records with constructor / toString fields ═════════════
  {
    id: 'r2-record-constructor-field',
    kind: 'different',
    original: ts`export function f(p: { constructor: number; toString: string }): { constructor: number; toString: string } { return { constructor: p.constructor + 1, toString: p.toString }; }`,
    candidate: ts`export function f(p: { constructor: number; toString: string }): { constructor: number; toString: string } { return { constructor: p.toString === "b" ? p.constructor : p.constructor + 1, toString: p.toString }; }`,
    bounds: [SMALL],
    truth: () => product(ints(-2, 2), strs(AB, 1)).map(([c, t]) => [{ constructor: c, toString: t }]),
  },
  {
    id: 'r2-record-valueOf-hasOwnProperty-equal',
    kind: 'equal',
    original: ts`export function f(p: { valueOf: number; hasOwnProperty: string }): string { return p.hasOwnProperty + p.valueOf; }`,
    candidate: ts`export function f(p: { valueOf: number; hasOwnProperty: string }): string { return %%#{p.hasOwnProperty}#{p.valueOf}%%; }`,
    bounds: [SMALL],
    truth: () => product(ints(-2, 2), strs(AB, 1)).map(([c, t]) => [{ valueOf: c, hasOwnProperty: t }]),
  },

  // ═════════════ stable sorts on string keys of records ═════════════
  {
    id: 'r2-sort-record-string-key-stable',
    // stable by name; the candidate breaks ties by v (differs only when names tie and v is out of order)
    kind: 'different',
    original: ts`export function f(rs: { name: string; v: number }[]): number[] { return rs.slice().sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0)).map((r) => r.v); }`,
    candidate: ts`export function f(rs: { name: string; v: number }[]): number[] { return rs.slice().sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0)).slice().sort((a, b) => a.v - b.v).sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0)).map((r) => r.v); }`,
    bounds: [SMALL],
    truth: () => arrs(product(strs(AB, 1), ints(0, 1)).map(([n, v]) => ({ name: n, v })), 2).map((a) => [a]),
  },
  {
    id: 'r2-sort-record-string-key-twice-equal',
    kind: 'equal',
    original: ts`export function f(rs: { name: string; v: number }[]): number[] { return rs.slice().sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0)).map((r) => r.v); }`,
    candidate: ts`export function f(rs: { name: string; v: number }[]): number[] { return rs.slice().sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0)).sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0)).map((r) => r.v); }`,
    bounds: [SMALL, { array: 3, string: 2, int: 4, unroll: 4 }],
    truth: () => arrs(product(strs(AB, 1), ints(0, 1)).map(([n, v]) => ({ name: n, v })), 2).map((a) => [a]),
  },
  {
    id: 'r2-sort-desc-sub-vs-threeway-equal',
    kind: 'equal',
    original: ts`export function f(rs: { k: string; n: number }[]): string[] { return rs.slice().sort((a, b) => b.n - a.n).map((r) => r.k); }`,
    candidate: ts`export function f(rs: { k: string; n: number }[]): string[] { return rs.slice().sort((a, b) => (a.n > b.n ? -1 : a.n < b.n ? 1 : 0)).map((r) => r.k); }`,
    bounds: [{ array: 3, string: 1, int: 4, unroll: 4 }],
    truth: () => arrs(product(['a', 'b'], ints(0, 1)).map(([k, n]) => ({ k, n })), 3).map((a) => [a]),
  },

  // ═════════════ for...of over split parts; mapI / filterI ═════════════
  {
    id: 'r2-forof-split-longest-part-equal',
    kind: 'equal',
    original: ts`export function f(s: string): number { let m = 0; for (const p of s.split(",")) { if (p.length > m) { m = p.length; } } return m; }`,
    candidate: ts`export function f(s: string): number { let m = 0; for (const p of s.split(",")) { if (p.length >= m) { m = p.length; } } return s.split(",").length > 1 ? m : s.length - 0 * m; }`,
    bounds: [SMALL, DEFAULT],
    // a refactoring (>= instead of >, and s itself when there is no comma): both return the longest part
    truth: () => strs(['a', ','], 3).map((s) => [s]),
  },
  {
    id: 'r2-mapI-split-index-parity',
    kind: 'different',
    original: ts`export function f(s: string): string { return s.split("").map((c, i) => (i % 2 === 0 ? c.toUpperCase() : c)).join(""); }`,
    candidate: ts`export function f(s: string): string { return s.split("").map((c, i) => (i % 2 === 1 ? c.toUpperCase() : c)).join(""); }`,
    bounds: [SMALL, DEFAULT],
    truth: () => strs(['a', 'B', '1'], 3).map((s) => [s]),
  },
  {
    id: 'r2-filterI-split-equal',
    kind: 'equal',
    original: ts`export function f(s: string): string { return s.split("").filter((c, i) => i % 2 === 0).join(""); }`,
    candidate: ts`export function f(s: string): string { let r = ""; for (let i = 0; i < s.length; i = i + 2) { r = r + s.charAt(i); } return r; }`,
    bounds: [SMALL, DEFAULT],
    truth: () => strs(AB, 3).map((s) => [s]),
  },

  // ═════════════ caesar shift with % ═════════════
  {
    id: 'r2-caesar-nonletter',
    // equal on 'a'..'z'; '{' (123) separates them, and the solver must find a non-letter
    kind: 'different',
    original: ts`export function f(s: string): number[] { return s.split("").map((c) => ((c.charCodeAt(0) - 97 + 1) % 26) + 97); }`,
    candidate: ts`export function f(s: string): number[] { return s.split("").map((c) => (c.charCodeAt(0) === 122 ? 97 : c.charCodeAt(0) + 1)); }`,
    bounds: [SMALL],
    truth: () => strs(['a', 'y', 'z', '{'], 2).map((s) => [s]),
  },
  {
    id: 'r2-caesar-negative-remainder',
    // for code units below 96 the original's % gives a negative remainder; the candidate's ((x % 26) + 26) % 26 does not
    kind: 'different',
    original: ts`export function f(s: string): number[] { return s.split("").map((c) => ((c.charCodeAt(0) - 97 + 1) % 26) + 97); }`,
    candidate: ts`export function f(s: string): number[] { return s.split("").map((c) => ((((c.charCodeAt(0) - 97 + 1) % 26) + 26) % 26) + 97); }`,
    bounds: [SMALL, DEFAULT],
    truth: () => strs(['a', 'z', 'A', '\u0000'], 2).map((s) => [s]),
  },

  // ═════════════ extreme positions ═════════════
  {
    id: 'r2-slice-extreme-equal',
    kind: 'equal',
    original: ts`export function f(s: string, a: number, b: number): string { return s.slice(a, b); }`,
    candidate: ts`export function f(s: string, a: number, b: number): string { const n = s.length; const x = a < 0 ? Math.max(n + a, 0) : Math.min(a, n); const y = b < 0 ? Math.max(n + b, 0) : Math.min(b, n); return x >= y ? "" : s.slice(x, y); }`,
    bounds: [BIG, SMALL],
    truth: () => product(strs(AB, 2), [-P53, -2, -1, 0, 1, 2, P53], [-P53, -1, 0, 1, P53]),
  },
  {
    id: 'r2-indexOf-extreme-pos',
    kind: 'different',
    original: ts`export function f(s: string, t: string, p: number): number { return s.indexOf(t, p); }`,
    candidate: ts`export function f(s: string, t: string, p: number): number { return p >= 9007199254740992 ? -1 : s.indexOf(t, p); }`,
    bounds: [BIG],
    truth: () => product(strs(AB, 1), strs(AB, 1), [P53, P53 - 1, -P53, 0]),
  },

  // ═════════════ decoding: strings with U+2028, U+FEFF, CR LF; Option<string>; tuples ═════════════
  {
    id: 'r2-decode-line-separators',
    kind: 'different',
    original: ts`export function f(s: string): number { return s.length === 3 && s.charCodeAt(0) === 8232 && s.charCodeAt(1) === 65279 && s.charCodeAt(2) === 13 ? 1 : 0; }`,
    candidate: ts`export function f(s: string): number { return 0; }`,
    bounds: [SMALL],
    truth: () => [[' ﻿\r'], [' ﻿\n'], [' ﻿'], ['']],
    expectInput: [' ﻿\r'],
  },
  {
    id: 'r2-decode-option-string',
    kind: 'different',
    original: ts`export function f(s: string): string | null { return s.length === 0 ? null : s.slice(1); }`,
    candidate: ts`export function f(s: string): string | null { return s.length === 0 ? null : s.length === 1 ? null : s.slice(1); }`,
    bounds: [SMALL],
    truth: () => strs(['a', ' '], 2).map((s) => [s]),
  },
  {
    id: 'r2-decode-tuple-big-string',
    kind: 'different',
    original: ts`export function f(p: [string, number]): number { return p[0] === "\"\\" && p[1] === -9007199254740991 ? 1 : 0; }`,
    candidate: ts`export function f(p: [string, number]): number { return 0; }`,
    bounds: [BIG],
    truth: () => [[['"\\', -P53 + 1]], [['"\\', -P53]], [['\\"', -P53 + 1]], [['', 0]]],
    expectInput: [['"\\', -P53 + 1]],
  },
  {
    id: 'r2-decode-array-of-records',
    kind: 'different',
    original: ts`export function f(rs: { k: string; n: number }[]): number { return rs.length === 2 && rs[1].k === "\u0000" && rs[1].n === -3 && rs[0].k === "" ? 1 : 0; }`,
    candidate: ts`export function f(rs: { k: string; n: number }[]): number { return 0; }`,
    bounds: [SMALL],
    truth: () => [[[{ k: '', n: 0 }, { k: '\u0000', n: -3 }]], [[{ k: 'a', n: 0 }, { k: '\u0000', n: -3 }]], [[]]],
  },

  // ═════════════ palindromes, string order of chars ═════════════
  {
    id: 'r2-palindrome-equal',
    kind: 'equal',
    original: ts`export function f(s: string): boolean { return s === s.split("").reduce((a, c) => c + a, ""); }`,
    candidate: ts`export function f(s: string): boolean { for (let i = 0; i < s.length; i++) { if (s.charAt(i) !== s.charAt(s.length - 1 - i)) { return false; } } return true; }`,
    bounds: [SMALL, DEFAULT],
    truth: () => strs(AB, 3).map((s) => [s]),
  },
  {
    id: 'r2-palindrome-half-off-by-one',
    kind: 'equal',
    original: ts`export function f(s: string): boolean { return s === s.split("").reduce((a, c) => c + a, ""); }`,
    candidate: ts`export function f(s: string): boolean { for (let i = 0; i < Math.floor(s.length / 2); i++) { if (s[i] !== s[s.length - 1 - i]) { return false; } } return true; }`,
    bounds: [SMALL, DEFAULT],
    truth: () => strs(AB, 3).map((s) => [s]),
  },
  {
    id: 'r2-char-gt-compare',
    kind: 'different',
    original: ts`export function f(s: string): number { let c = 0; for (let i = 1; i < s.length; i++) { if (s[i] > s[i - 1]) { c = c + 1; } } return c; }`,
    candidate: ts`export function f(s: string): number { let c = 0; for (let i = 1; i < s.length; i++) { if (s.charCodeAt(i) >= s.charCodeAt(i - 1)) { c = c + 1; } } return c; }`,
    bounds: [SMALL, DEFAULT],
    truth: () => strs(AB, 3).map((s) => [s]),
  },

  // ═════════════ replaceAll by split/join vs loop ═════════════
  {
    id: 'r2-count-split-vs-overlapping-loop',
    // split counts non-overlapping matches, the loop counts overlapping ones: "aaa" / "aa"
    kind: 'different',
    original: ts`export function f(s: string, t: string): number { return t.length === 0 ? 0 : s.split(t).length - 1; }`,
    candidate: ts`export function f(s: string, t: string): number { if (t.length === 0) { return 0; } let c = 0; for (let i = 0; i <= s.length - t.length; i++) { if (s.slice(i, i + t.length) === t) { c = c + 1; } } return c; }`,
    bounds: [SMALL, DEFAULT],
    truth: () => product(strs(AB, 3), strs(AB, 2)),
  },
  {
    id: 'r2-count-split-vs-indexOf-loop-equal',
    kind: 'equal',
    original: ts`export function f(s: string): number { return s.split("ab").length - 1; }`,
    candidate: ts`export function f(s: string): number { let c = 0; for (let i = 0; i < s.length - 1; i++) { if (s.charAt(i) === "a" && s.charAt(i + 1) === "b") { c = c + 1; } } return c; }`,
    bounds: [SMALL, DEFAULT],
    truth: () => strs(AB, 3).map((s) => [s]),
  },
  // ═════════════ decoding and replay: odd field and parameter names ═════════════
  {
    id: 'r2-decode-odd-field-names',
    kind: 'different',
    original: ts`export function f(p: { "a b": string; then: number; toJSON: number }): number { return p["a b"] === "x\ty" && p.then === -2 && p.toJSON === 3 ? 1 : 0; }`,
    candidate: ts`export function f(p: { "a b": string; then: number; toJSON: number }): number { return 0; }`,
    bounds: [{ array: 1, string: 3, int: 4, unroll: 2 }],
    truth: () => [[{ 'a b': 'x\ty', then: -2, toJSON: 3 }], [{ 'a b': 'x\ty', then: 2, toJSON: 3 }], [{ 'a b': '', then: -2, toJSON: 3 }]],
    expectInput: [{ 'a b': 'x\ty', then: -2, toJSON: 3 }],
  },
  {
    id: 'r2-return-odd-field-names',
    kind: 'different',
    original: ts`export function f(s: string): { then: string; toJSON: number } | null { return s.length === 0 ? null : { then: s, toJSON: s.length }; }`,
    candidate: ts`export function f(s: string): { then: string; toJSON: number } | null { return s.length === 0 ? null : { then: s, toJSON: s.length === 2 ? 0 : s.length }; }`,
    bounds: [SMALL],
    truth: () => strs(AB, 3).map((s) => [s]),
  },
  {
    id: 'r2-reserved-runtime-param-name',
    kind: 'different',
    original: ts`export function f(__faithful: number, s: string): string { return %%#{__faithful + 1}|#{s.toUpperCase()}%%; }`,
    candidate: ts`export function f(__faithful: number, s: string): string { return %%#{__faithful + 2}|#{s.toUpperCase()}%%; }`,
    bounds: [SMALL],
    truth: () => product(ints(-4, 4), strs(AB, 1)),
  },
];

/** Probes of verifiedToK (adaptive k): the difference exists only at the largest default step. */
export const ADAPTIVE2 = [
  {
    id: 'r2-adaptive-last-step-only',
    original: ts`export function f(s: string): number { return s.length === 8 && s.charAt(7) === "z" ? 1 : 0; }`,
    candidate: ts`export function f(s: string): number { return 0; }`,
    // expected: sat at the step with strings 8 (the last default step), not an earlier stop
    expectString: 8,
  },
];
