/**
 * Red-team round 3, area strings-decode (packages/smt): fresh probe pairs (rounds 1 and 2 are in cases.mjs and
 * cases2.mjs and are re-run unchanged). Same format and `kind` semantics:
 *   'different'  sat, replayed outcomes differ, the encoder's predicted outcomes equal the replayed ones
 *   'equal'      unsat (the pair agrees on every input inside every listed bound; ground truth checks the first one)
 * `truth()` lies inside the FIRST bounds entry and is exhaustive over the stated alphabet / integer range (or lists the
 * analytic boundary points). `expectInput`: the only distinguishing input in the truth domain. `concrete`: extra
 * adversarial inputs for sanity mode only.
 *
 * Families round 1 and 2 did not touch:
 *   - split with a SYMBOLIC separator composed with indexOf loops (count, second part, replace-all = split+join)
 *   - join after every operation that carries the `sum` bound (filter, sort, slice, concat, for...of tail, if-merge),
 *     which is the bound `join` truncates its result to
 *   - indexOf(t, i) against slice(i).indexOf(t) + i (negative and past-the-end i)
 *   - intToStr: digit round trip at ±2^53, the 17th character of a negative 16-digit number, last digit via slice(-1)
 *   - string order on concatenations, max via reduce vs sorted copy, <= / >= on slices of different capacity
 *   - case maps compared through each other, counted through split("")
 *   - decoding: arrays of tuples with escapes and -2^53, nested record with string[], Option<tuple> with U+2028/9,
 *     records with numeric keys and literal field order, string arrays with empty strings, 2^52 * 2 at the boundary
 *
 * TypeScript sources use `%%` for a backtick and `#{` for a template-literal substitution (as in cases.mjs).
 */
import { arrs, ints, product, strs } from './cases.mjs';

const ts = (s, ...v) => String.raw(s, ...v).replaceAll('#{', '${').replaceAll('%%', '`');

const SMALL = { array: 2, string: 3, int: 4, unroll: 8 };
const S4 = { array: 2, string: 4, int: 4, unroll: 8 };
const MID = { array: 3, string: 3, int: 12, unroll: 8 };
const DEFAULT = { array: 6, string: 8, int: 2 ** 16, unroll: 10 };
const BIG = { array: 1, string: 1, int: 2 ** 53, unroll: 2 };
const AB = ['a', 'b'];
const ACB = ['a', ',', 'b'];
const P53 = 2 ** 53;
const NUMS = [0, 1, -1, 9, 10, -10, 99, -100, 4503599627370496, P53, -P53, P53 - 1, -(P53 - 1), 999999999999999, 1e15, -1e15, -999999999999999];

export const CASES3 = [
  // ═════════════ split with a symbolic separator ═════════════
  {
    id: 'r3-split-sym-count-vs-indexOf-loop-equal',
    kind: 'equal',
    original: ts`export function f(s: string, t: string): number { return t.length === 0 ? -1 : s.split(t).length - 1; }`,
    candidate: ts`export function f(s: string, t: string): number { if (t.length === 0) { return -1; } let c = 0; let skip = 0; for (let k = 0; k < s.length; k++) { if (k >= skip && s.indexOf(t, k) === k) { c = c + 1; skip = k + t.length; } } return c; }`,
    bounds: [SMALL, S4],
    truth: () => product(strs(AB, 3), strs(AB, 2)),
  },
  {
    id: 'r3-split-sym-count-overlapping-off',
    kind: 'different',
    original: ts`export function f(s: string, t: string): number { return t.length === 0 ? -1 : s.split(t).length - 1; }`,
    candidate: ts`export function f(s: string, t: string): number { if (t.length === 0) { return -1; } let c = 0; for (let k = 0; k < s.length; k++) { if (s.indexOf(t, k) === k) { c = c + 1; } } return c; }`,
    bounds: [SMALL, S4],
    truth: () => product(strs(AB, 3), strs(AB, 2)),
  },
  {
    id: 'r3-split-sym-second-part-equal',
    kind: 'equal',
    original: ts`export function f(s: string, t: string): string { const p = s.split(t); return p.length > 1 ? p[1] : "?"; }`,
    candidate: ts`export function f(s: string, t: string): string { if (t.length === 0) { return s.length > 1 ? s.charAt(1) : "?"; } const i = s.indexOf(t); if (i < 0) { return "?"; } const j = s.indexOf(t, i + t.length); return j < 0 ? s.slice(i + t.length) : s.slice(i + t.length, j); }`,
    bounds: [SMALL, S4],
    truth: () => product(strs(AB, 3), strs(AB, 2)),
  },
  {
    id: 'r3-split-sym-second-part-off',
    // forgets the end of the second part: differs only when there are at least three parts
    kind: 'different',
    original: ts`export function f(s: string, t: string): string { const p = s.split(t); return p.length > 1 ? p[1] : "?"; }`,
    candidate: ts`export function f(s: string, t: string): string { if (t.length === 0) { return s.length > 1 ? s.charAt(1) : "?"; } const i = s.indexOf(t); if (i < 0) { return "?"; } return s.slice(i + t.length); }`,
    bounds: [SMALL, S4],
    truth: () => product(strs(AB, 3), strs(AB, 2)),
  },
  {
    id: 'r3-split-join-replace-all-equal',
    kind: 'equal',
    original: ts`export function f(s: string, a: string, b: string): string { return s.split(a).join(b); }`,
    candidate: ts`export function f(s: string, a: string, b: string): string { if (a.length === 0) { return s.split("").join(b); } let r = ""; let skip = 0; for (let i = 0; i < s.length; i++) { if (i >= skip) { if (s.slice(i, i + a.length) === a) { r = r + b; skip = i + a.length; } else { r = r + s.charAt(i); } } } return r; }`,
    bounds: [SMALL],
    truth: () => product(strs(AB, 3), strs(AB, 2), strs(['a', 'x'], 2)),
  },
  {
    id: 'r3-split-join-replace-all-overlap-off',
    kind: 'different',
    original: ts`export function f(s: string, a: string, b: string): string { return s.split(a).join(b); }`,
    candidate: ts`export function f(s: string, a: string, b: string): string { if (a.length === 0) { return s.split("").join(b); } let r = ""; for (let i = 0; i < s.length; i++) { if (s.slice(i, i + a.length) === a) { r = r + b; } else { r = r + s.charAt(i); } } return r; }`,
    bounds: [SMALL],
    truth: () => product(strs(AB, 3), strs(AB, 2), strs(['a', 'x'], 2)),
  },
  {
    id: 'r3-split-sym-vs-indexOf-includes',
    // "".split("") is [] and "a".split("") is ["a"]: split-length > 1 is not "contains t" for the empty t
    kind: 'different',
    original: ts`export function f(s: string, t: string): boolean { return s.split(t).length > 1; }`,
    candidate: ts`export function f(s: string, t: string): boolean { return s.indexOf(t) >= 0; }`,
    bounds: [SMALL, DEFAULT],
    truth: () => product(strs(AB, 3), strs(AB, 2)),
  },
  {
    id: 'r3-split-sym-includes-guarded-equal',
    kind: 'equal',
    original: ts`export function f(s: string, t: string): boolean { return t.length === 0 ? s.length > 1 : s.split(t).length > 1; }`,
    candidate: ts`export function f(s: string, t: string): boolean { return t.length === 0 ? s.length >= 2 : s.indexOf(t) >= 0; }`,
    bounds: [SMALL, DEFAULT],
    truth: () => product(strs(AB, 3), strs(AB, 2)),
  },

  // ═════════════ join after operations that carry the `sum` bound ═════════════
  {
    id: 'r3-join-filter-split-equal',
    kind: 'equal',
    original: ts`export function f(s: string): string { return s.split(",").filter((x) => x.length > 0).join(""); }`,
    candidate: ts`export function f(s: string): string { let r = ""; for (let i = 0; i < s.length; i++) { if (s.charAt(i) !== ",") { r = r + s.charAt(i); } } return r; }`,
    bounds: [SMALL, DEFAULT],
    truth: () => strs(ACB, 4).map((s) => [s]),
  },
  {
    id: 'r3-join-sort-split-length-equal',
    kind: 'equal',
    original: ts`export function f(s: string): number { return s.split(",").sort().join(",").length; }`,
    candidate: ts`export function f(s: string): number { return s.length; }`,
    bounds: [SMALL, DEFAULT],
    truth: () => strs(ACB, 3).map((s) => [s]),
  },
  {
    id: 'r3-join-sort-split-content',
    kind: 'different',
    original: ts`export function f(s: string): string { return s.split(",").sort().join(","); }`,
    candidate: ts`export function f(s: string): string { return s; }`,
    bounds: [SMALL, DEFAULT],
    truth: () => strs(ACB, 3).map((s) => [s]),
  },
  {
    id: 'r3-join-slice-split-equal',
    kind: 'equal',
    original: ts`export function f(s: string): string { return s.split(",").slice(1).join(","); }`,
    candidate: ts`export function f(s: string): string { return s.indexOf(",") < 0 ? "" : s.slice(s.indexOf(",") + 1); }`,
    bounds: [SMALL, DEFAULT],
    truth: () => strs(ACB, 4).map((s) => [s]),
  },
  {
    id: 'r3-join-concat-splits-equal',
    kind: 'equal',
    original: ts`export function f(s: string, t: string): string { return s.split(",").concat(t.split(",")).join(","); }`,
    candidate: ts`export function f(s: string, t: string): string { return s + "," + t; }`,
    // at DEFAULT Z3 times out after 120 s (`unknown`, honest)
    bounds: [SMALL, { array: 4, string: 5, int: 4, unroll: 8 }],
    truth: () => product(strs(ACB, 3), strs(ACB, 2)),
  },
  {
    id: 'r3-join-forof-tail-equal',
    kind: 'equal',
    original: ts`export function f(s: string): string { let r = ""; let first = true; for (const p of s.split(",")) { if (!first) { r = r + p + ";"; } first = false; } return r; }`,
    candidate: ts`export function f(s: string): string { return s.split(",").slice(1).map((p) => p + ";").join(""); }`,
    bounds: [SMALL, { array: 2, string: 6, int: 4, unroll: 8 }],
    truth: () => strs(ACB, 4).map((s) => [s]),
  },
  {
    id: 'r3-join-mapped-double-length-equal',
    kind: 'equal',
    original: ts`export function f(xs: string[]): number { return xs.map((x) => x + x).join("").length; }`,
    candidate: ts`export function f(xs: string[]): number { return 2 * xs.join("").length; }`,
    bounds: [{ array: 2, string: 2, int: 4, unroll: 4 }, DEFAULT],
    truth: () => arrs(strs(AB, 2), 2).map((a) => [a]),
  },
  {
    id: 'r3-join-nested-split-equal',
    kind: 'equal',
    original: ts`export function f(s: string): string { return s.split(",").map((p) => p.split("").join("+")).join(","); }`,
    candidate: ts`export function f(s: string): string { let r = ""; for (let i = 0; i < s.length; i++) { const c = s.charAt(i); if (c !== "," && i > 0 && s.charAt(i - 1) !== ",") { r = r + "+"; } r = r + c; } return r; }`,
    bounds: [SMALL, { array: 2, string: 6, int: 4, unroll: 8 }],
    truth: () => strs(ACB, 4).map((s) => [s]),
  },
  {
    id: 'r3-join-if-merge-sum-equal',
    kind: 'equal',
    original: ts`export function f(b: boolean, s: string, t: string): string { return (b ? s.split(",") : [t, t, t]).join(""); }`,
    candidate: ts`export function f(b: boolean, s: string, t: string): string { return b ? s.split(",").join("") : t + t + t; }`,
    bounds: [SMALL, DEFAULT],
    truth: () => product([true, false], strs(ACB, 3), strs(AB, 2)),
  },
  {
    id: 'r3-join-merge-slice-concat-equal',
    kind: 'equal',
    original: ts`export function f(s: string, t: string): string { return (s.length > 1 ? s.split(",").slice(1) : s.split(";")).concat([t]).join("|"); }`,
    candidate: ts`export function f(s: string, t: string): string { return s.length > 1 ? s.split(",").slice(1).concat([t]).join("|") : s.split(";").concat([t]).join("|"); }`,
    bounds: [SMALL, DEFAULT],
    truth: () => product(strs([',', ';', 'a'], 3), strs(AB, 2)),
  },
  {
    id: 'r3-join-reduce-concat-split-equal',
    kind: 'equal',
    original: ts`export function f(s: string): string { return s.split(",").reduce((acc, x) => acc.concat([x, x]), s.split(",").slice(0, 0)).join("."); }`,
    candidate: ts`export function f(s: string): string { return s.split(",").map((x) => x + "." + x).join("."); }`,
    bounds: [SMALL, { array: 2, string: 5, int: 4, unroll: 8 }],
    truth: () => strs(ACB, 3).map((s) => [s]),
  },

  // ═════════════ indexOf(t, i) vs slice(i).indexOf(t) + i ═════════════
  {
    id: 'r3-indexOf-pos-vs-slice-neg',
    kind: 'different',
    original: ts`export function f(s: string, t: string, i: number): number { return s.indexOf(t, i); }`,
    candidate: ts`export function f(s: string, t: string, i: number): number { return s.slice(i).indexOf(t) < 0 ? -1 : s.slice(i).indexOf(t) + i; }`,
    bounds: [SMALL, DEFAULT],
    truth: () => product(strs(AB, 3), strs(AB, 1), ints(-4, 4)),
  },
  {
    id: 'r3-indexOf-pos-vs-slice-guarded-equal',
    kind: 'equal',
    original: ts`export function f(s: string, t: string, i: number): number { return s.indexOf(t, i); }`,
    candidate: ts`export function f(s: string, t: string, i: number): number { if (i < 0) { return s.indexOf(t); } if (i > s.length) { return t.length === 0 ? s.length : -1; } const k = s.slice(i).indexOf(t); return k < 0 ? -1 : k + i; }`,
    bounds: [SMALL, DEFAULT],
    truth: () => product(strs(AB, 3), strs(AB, 2), ints(-4, 4)),
  },
  {
    id: 'r3-indexOf-at-length-equal',
    kind: 'equal',
    original: ts`export function f(s: string, t: string): number { return s.indexOf(t, s.length); }`,
    candidate: ts`export function f(s: string, t: string): number { return t.length === 0 ? s.length : -1; }`,
    bounds: [SMALL, DEFAULT],
    truth: () => product(strs(AB, 3), strs(AB, 2)),
  },

  // ═════════════ string order ═════════════
  {
    id: 'r3-strlt-concat-order',
    kind: 'different',
    original: ts`export function f(a: string, b: string): boolean { return a + b < b + a; }`,
    candidate: ts`export function f(a: string, b: string): boolean { return a < b; }`,
    bounds: [SMALL, DEFAULT],
    truth: () => product(strs(AB, 3), strs(AB, 3)),
  },
  {
    id: 'r3-strle-slices-equal',
    kind: 'equal',
    original: ts`export function f(a: string, b: string): boolean { return a.slice(1) <= b && b >= a.slice(1); }`,
    candidate: ts`export function f(a: string, b: string): boolean { return !(b < a.slice(1)); }`,
    bounds: [SMALL, DEFAULT],
    truth: () => product(strs(AB, 3), strs(AB, 2)),
  },
  {
    id: 'r3-strle-antisym-equal',
    kind: 'equal',
    original: ts`export function f(a: string, b: string): boolean { return a.slice(1) <= b && b <= a.slice(1); }`,
    candidate: ts`export function f(a: string, b: string): boolean { return a.slice(1) === b; }`,
    bounds: [SMALL, DEFAULT],
    truth: () => product(strs(AB, 3), strs(AB, 2)),
  },
  {
    id: 'r3-max-string-reduce-vs-sort-equal',
    kind: 'equal',
    original: ts`export function f(xs: string[]): string { return xs.reduce((m, x) => (x > m ? x : m), ""); }`,
    candidate: ts`export function f(xs: string[]): string { return xs.length === 0 ? "" : xs.slice().sort()[xs.length - 1]; }`,
    bounds: [MID, DEFAULT],
    truth: () => arrs(strs(AB, 2), 3).map((a) => [a]),
  },
  {
    id: 'r3-sort-records-str-key-vs-default-of-keys',
    // stable sort of records by a string key vs sorting the keys alone and pairing them with the ORIGINAL payloads
    kind: 'different',
    original: ts`export function f(xs: Array<{ k: string; v: number }>): string { return xs.slice().sort((a, b) => (a.k < b.k ? -1 : a.k > b.k ? 1 : 0)).map((x) => x.k + x.v).join(","); }`,
    candidate: ts`export function f(xs: Array<{ k: string; v: number }>): string { const ks = xs.map((x) => x.k).sort(); return xs.map((x, i) => ks[i] + x.v).join(","); }`,
    // at MID Z3 times out after 120 s (`unknown`, honest)
    bounds: [{ array: 2, string: 1, int: 1, unroll: 4 }],
    truth: () => arrs(product(strs(AB, 1), [0, 1]).map(([k, v]) => ({ k, v })), 2).map((a) => [a]),
  },
  {
    id: 'r3-sort-records-str-key-desc-equal',
    kind: 'equal',
    original: ts`export function f(xs: Array<{ k: string; v: number }>): string { return xs.slice().sort((a, b) => (a.k < b.k ? 1 : a.k > b.k ? -1 : 0)).map((x) => x.k + x.v).join(","); }`,
    candidate: ts`export function f(xs: Array<{ k: string; v: number }>): string { return xs.slice().sort((a, b) => (b.k > a.k ? 1 : b.k < a.k ? -1 : 0)).map((x) => %%#{x.k}#{x.v}%%).join(); }`,
    bounds: [{ array: 3, string: 1, int: 1, unroll: 4 }, MID],
    truth: () => arrs(product(strs(AB, 1), [0, 1]).map(([k, v]) => ({ k, v })), 3).map((a) => [a]),
  },

  // ═════════════ case maps ═════════════
  {
    id: 'r3-case-upper-eq-vs-lower-eq-equal',
    kind: 'equal',
    original: ts`export function f(s: string, t: string): boolean { return s.toUpperCase() === t.toUpperCase(); }`,
    candidate: ts`export function f(s: string, t: string): boolean { return s.toLowerCase() === t.toLowerCase(); }`,
    bounds: [SMALL, DEFAULT],
    truth: () => product(strs(['a', 'A', '`', '{', 'Z'], 2), strs(['a', 'A', '@', 'z'], 2)),
  },
  {
    id: 'r3-case-count-lower-letters-equal',
    kind: 'equal',
    original: ts`export function f(s: string): number { return s.split("").filter((c) => c.toUpperCase() !== c).length; }`,
    candidate: ts`export function f(s: string): number { return s.split("").filter((c) => c >= "a" && c <= "z").length; }`,
    bounds: [SMALL, DEFAULT],
    truth: () => strs(['a', 'z', '`', '{', 'A', 'é'], 3).map((s) => [s]),
  },
  {
    id: 'r3-case-count-lower-letters-off',
    kind: 'different',
    original: ts`export function f(s: string): number { return s.split("").filter((c) => c.toUpperCase() !== c).length; }`,
    candidate: ts`export function f(s: string): number { return s.split("").filter((c) => c > "a" && c <= "z").length; }`,
    bounds: [SMALL, DEFAULT],
    truth: () => strs(['a', 'z', '`', '{', 'A'], 3).map((s) => [s]),
  },

  // ═════════════ intToStr ═════════════
  {
    id: 'r3-int-digits-roundtrip-equal',
    kind: 'equal',
    original: ts`export function f(n: number): number { return %%#{Math.abs(n)}%%.split("").reduce((a, c) => a * 10 + (c.charCodeAt(0) - 48), 0); }`,
    candidate: ts`export function f(n: number): number { return Math.abs(n); }`,
    // at ±2^53 Z3 times out after 120 s (`unknown`, honest); at DEFAULT (±2^16) unsat takes about 110 s and at ±99999 it times out
    bounds: [{ array: 1, string: 1, int: 999, unroll: 2 }],
    truth: () => ints(-999, 999).map((n) => [n]),
  },
  {
    id: 'r3-int-last-digit-slice-equal',
    kind: 'equal',
    original: ts`export function f(n: number): string { return %%#{n}%%.slice(-1); }`,
    candidate: ts`export function f(n: number): string { return %%#{Math.abs(n % 10)}%%; }`,
    bounds: [BIG, DEFAULT],
    truth: () => [...NUMS, ...ints(-30, 30)].map((n) => [n]),
  },
  {
    id: 'r3-int-17th-char-equal',
    kind: 'equal',
    original: ts`export function f(n: number): string { return %%#{n}%%.charAt(16); }`,
    candidate: ts`export function f(n: number): string { return n <= -1000000000000000 ? %%#{-n}%%.charAt(15) : ""; }`,
    bounds: [BIG],
    truth: () => NUMS.map((n) => [n]),
  },
  {
    id: 'r3-int-17th-char-only-min',
    // forgets that every negative 16-digit number has 17 characters
    kind: 'different',
    original: ts`export function f(n: number): string { return %%#{n}%%.charAt(16); }`,
    candidate: ts`export function f(n: number): string { return n === -9007199254740992 ? "2" : ""; }`,
    bounds: [BIG],
    truth: () => NUMS.map((n) => [n]),
  },

  // ═════════════ decoding ═════════════
  {
    id: 'r3-dec-array-of-tuples',
    kind: 'different',
    original: ts`export function f(xs: Array<[string, number]>): number { return xs.length === 2 && xs[0][0] === "\"" && xs[0][1] === 3 && xs[1][0] === "\\" && xs[1][1] === -9007199254740992 ? 1 : 0; }`,
    candidate: ts`export function f(xs: Array<[string, number]>): number { return 0; }`,
    bounds: [{ array: 2, string: 1, int: P53, unroll: 2 }],
    truth: () => arrs(product(['"', '\\', ''], [3, -P53, 0]), 2).map((a) => [a]),
    expectInput: [[['"', 3], ['\\', -P53]]],
  },
  {
    id: 'r3-dec-nested-record-string-array',
    kind: 'different',
    original: ts`export function f(r: { name: string; tags: string[] }): number { return r.tags.length === 2 && r.tags[1] === r.name && r.name.length === 2 && r.tags[0] === "" ? 1 : 0; }`,
    candidate: ts`export function f(r: { name: string; tags: string[] }): number { return 0; }`,
    bounds: [{ array: 2, string: 2, int: 4, unroll: 2 }],
    truth: () => product(strs(['\n', 'a'], 2), arrs(strs(['\n', 'a'], 2), 2)).map(([name, tags]) => [{ name, tags }]),
  },
  {
    id: 'r3-dec-option-tuple-line-separators',
    kind: 'different',
    original: ts`export function f(s: string): [string, number] | null { return s.length === 0 ? null : [s + " ", -s.length]; }`,
    candidate: ts`export function f(s: string): [string, number] | null { return s.length === 0 ? null : [s + " ", -s.length]; }`,
    bounds: [SMALL],
    truth: () => strs([' ', 'a'], 2).map((s) => [s]),
  },
  {
    id: 'r3-dec-record-numeric-keys',
    kind: 'different',
    original: ts`export function f(s: string): { "0": string; "1": number; b: string } { return { "1": s.length, b: s, "0": s + "!" }; }`,
    candidate: ts`export function f(s: string): { "0": string; "1": number; b: string } { return { "1": s.length === 2 ? 0 : s.length, b: s, "0": s + "!" }; }`,
    bounds: [SMALL],
    truth: () => strs(AB, 3).map((s) => [s]),
  },
  {
    id: 'r3-dec-record-literal-order-equal',
    kind: 'equal',
    original: ts`export function f(s: string): { "0": string; "1": number; b: string } { return { "1": s.length, b: s, "0": s + "!" }; }`,
    candidate: ts`export function f(s: string): { "0": string; "1": number; b: string } { return { b: s, "0": s + "!", "1": s.length }; }`,
    bounds: [SMALL, DEFAULT],
    truth: () => strs(AB, 3).map((s) => [s]),
  },
  {
    id: 'r3-dec-split-empty-parts',
    kind: 'different',
    original: ts`export function f(s: string): string[] { return s.split(","); }`,
    candidate: ts`export function f(s: string): string[] { return s.split(",").filter((x) => x.length > 0); }`,
    bounds: [SMALL],
    truth: () => strs(ACB, 3).map((s) => [s]),
  },
  {
    id: 'r3-dec-double-at-2^52-equal',
    kind: 'equal',
    original: ts`export function f(xs: number[]): number[] { return xs.map((x) => x * 2); }`,
    candidate: ts`export function f(xs: number[]): number[] { return xs.map((x) => (x === 4503599627370496 ? 9007199254740992 : x === -4503599627370496 ? -9007199254740992 : x + x)); }`,
    bounds: [{ array: 2, string: 1, int: P53, unroll: 2 }],
    truth: () => arrs([0, 1, -1, 4503599627370496, -4503599627370496, 4503599627370495, P53], 2).map((a) => [a]),
  },

  // ═════════════ char codes and loops over strings ═════════════
  {
    id: 'r3-charcode-sum-equal',
    kind: 'equal',
    original: ts`export function f(s: string): number { return s.split("").reduce((a, c) => a + c.charCodeAt(0), 0); }`,
    candidate: ts`export function f(s: string): number { let a = 0; for (let i = 0; i < s.length; i++) { a = a + s.charCodeAt(i); } return a; }`,
    bounds: [SMALL, DEFAULT],
    truth: () => strs(['\u0000', '￿', '퟿', 'a'], 3).map((s) => [s]),
  },
  {
    id: 'r3-reverse-reduce-vs-loop-equal',
    kind: 'equal',
    original: ts`export function f(s: string): string { return s.split("").reduce((a, c) => c + a, ""); }`,
    candidate: ts`export function f(s: string): string { let r = ""; for (let i = s.length - 1; i >= 0; i--) { r = r + s[i]; } return r; }`,
    bounds: [SMALL, DEFAULT],
    truth: () => strs(['a', 'b', ' '], 3).map((s) => [s]),
  },
  {
    id: 'r3-reverse-off-by-one',
    kind: 'different',
    original: ts`export function f(s: string): string { return s.split("").reduce((a, c) => c + a, ""); }`,
    candidate: ts`export function f(s: string): string { let r = ""; for (let i = s.length - 1; i > 0; i--) { r = r + s[i]; } return r; }`,
    bounds: [SMALL, DEFAULT],
    truth: () => strs(AB, 3).map((s) => [s]),
  },
  {
    id: 'r3-lower-indexOf-array-equal',
    kind: 'equal',
    original: ts`export function f(xs: string[], y: string): number { return xs.map((x) => x.toLowerCase()).indexOf(y.toLowerCase()); }`,
    candidate: ts`export function f(xs: string[], y: string): number { const z = y.toLowerCase(); let k = -1; for (let i = xs.length - 1; i >= 0; i--) { if (xs[i].toLowerCase() === z) { k = i; } } return k; }`,
    bounds: [{ array: 2, string: 2, int: 4, unroll: 4 }, DEFAULT],
    truth: () => product(arrs(strs(['a', 'A'], 1), 2), strs(['a', 'A'], 1)),
  },

  // ═════════════ coverage: trip counts driven by strings nested in records / arrays (never `unsat`) ═════════════
  {
    id: 'r3-vac-record-field-charcode',
    kind: 'vacuous',
    original: ts`export function f(r: { s: string; n: number }): number { let c = 0; for (let i = 0; i < r.s.charCodeAt(0) - 90; i++) { c = c + 1; } return c + r.n; }`,
    candidate: ts`export function f(r: { s: string; n: number }): number { const d = r.s.charCodeAt(0) - 90; return d > 12 ? r.n : Math.max(d, 0) + r.n; }`,
    bounds: [SMALL, DEFAULT],
    truth: () => product(['Z', 'f', 'g', 'z', '\u00ff'], [0, 1]).map(([s, n]) => [{ s, n }]),
  },
  {
    id: 'r3-vac-string-array-indexOf-driven',
    kind: 'vacuous',
    original: ts`export function f(xs: string[]): number { let c = 0; for (let i = 0; i < xs.indexOf("z") * 5; i++) { c = c + 1; } return c; }`,
    candidate: ts`export function f(xs: string[]): number { const k = xs.indexOf("z"); return k >= 3 ? 0 : Math.max(k * 5, 0); }`,
    bounds: [DEFAULT],
    truth: () => [[['a', 'a', 'a', 'z']], [['z']], [[]], [['a', 'z']], [['a', 'a', 'a', 'a', 'z']]],
  },
  {
    id: 'r3-vac-split-sym-count-driven',
    kind: 'vacuous',
    original: ts`export function f(s: string, t: string): number { let c = 0; for (let i = 0; i < s.split(t).length * 3; i++) { c = c + 1; } return c; }`,
    candidate: ts`export function f(s: string, t: string): number { const n = s.split(t).length; return n >= 4 ? 0 : n * 3; }`,
    bounds: [DEFAULT],
    truth: () => [[',,,', ','], ['abcd', ''], ['', ''], ['a', ','], ['a,b', ',']],
  },
  {
    id: 'r3-vac-tuple-string-gated-by-int',
    // the loop runs over the string length, but only when the integer is 0: every all-zero-integer input is excluded
    kind: 'vacuous',
    original: ts`export function f(p: [string, number]): number { if (p[1] !== 0) { return p[1]; } let c = 0; for (let i = 0; i < p[0].length * 3; i++) { c = c + 1; } return c; }`,
    candidate: ts`export function f(p: [string, number]): number { if (p[1] !== 0) { return p[1]; } return p[0].length >= 4 ? 0 : p[0].length * 3; }`,
    bounds: [DEFAULT],
    truth: () => [[['abcd', 0]], [['abc', 0]], [['', 5]], [['abcdefgh', 0]]],
  },
  {
    id: 'r3-vac-record-array-of-records-int-in-string-loop',
    // trip count = sum of the lengths of strings nested two levels deep
    kind: 'vacuous',
    original: ts`export function f(xs: Array<{ s: string }>): number { const t = xs.map((x) => x.s).join(""); let c = 0; for (let i = 0; i < t.length * 2; i++) { c = c + 1; } return c; }`,
    candidate: ts`export function f(xs: Array<{ s: string }>): number { const n = xs.map((x) => x.s).join("").length; return n > 5 ? 0 : n * 2; }`,
    bounds: [DEFAULT],
    truth: () => [[[{ s: 'abc' }, { s: 'abc' }]], [[{ s: 'ab' }]], [[]]],
  },
];
