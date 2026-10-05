/**
 * Red-team round 1, area strings-decode (packages/smt): probe pairs for the bounded SMT tier.
 *
 * Each case is (original, candidate) TypeScript in the subset, the bounds the equivalence query is run at, and a
 * ground-truth input domain that lies INSIDE the first bounds (`truth()`: exhaustive over the stated alphabet / integer
 * range, or the analytic boundary points for the ±2^53 probes). The test file runs the same functions in the sandbox
 * (range-instrumented) over that domain, so the expectation never rests on the encoder.
 *
 * kind
 *   'different'  the pair differs on some input inside the bounds: the query must be `sat` with a counterexample whose
 *                replayed outcomes differ, and the encoder's predicted outcomes must equal the replayed ones.
 *   'equal'      the pair agrees on every input inside the bounds (checked by brute force): the query must be `unsat`.
 *   'vacuous'    the pair differs on (almost) every input inside the bounds, but only on inputs that need more than U
 *                iterations: any answer is acceptable except `unsat` ("Verified to k" would be a false claim).
 *
 * `expectInput` (optional): the only distinguishing input inside the bounds; the decoded counterexample must equal it
 * exactly (decoding of negative / near-2^53 integers, escaped strings, records, options).
 * `concrete` (optional): adversarial inputs for sanity mode (the encoding evaluated on constants vs the sandbox).
 *
 * TypeScript sources use `%%` for a backtick and `#{` for a template-literal substitution (replaced below) so that this
 * file can use String.raw and keep backslash escapes verbatim.
 */
const ts = (s, ...v) => String.raw(s, ...v).replaceAll('#{', '${').replaceAll('%%', '`');

// ───────────── ground-truth domains ─────────────
export function strs(alpha, max) {
  const out = [''];
  let layer = [''];
  for (let l = 1; l <= max; l++) {
    const nx = [];
    for (const s of layer) for (const ch of alpha) nx.push(s + ch);
    out.push(...nx);
    layer = nx;
  }
  return out;
}
export function ints(lo, hi) {
  const o = [];
  for (let i = lo; i <= hi; i++) o.push(i);
  return o;
}
export function arrs(elems, max) {
  const out = [[]];
  let layer = [[]];
  for (let l = 1; l <= max; l++) {
    const nx = [];
    for (const a of layer) for (const e of elems) nx.push([...a, e]);
    out.push(...nx);
    layer = nx;
  }
  return out;
}
export function product(...lists) {
  let out = [[]];
  for (const l of lists) out = out.flatMap((p) => l.map((x) => [...p, x]));
  return out;
}

const SMALL = { array: 2, string: 3, int: 4, unroll: 8 };
const DEFAULT = { array: 6, string: 8, int: 2 ** 16, unroll: 10 };
const BIG = { array: 1, string: 1, int: 2 ** 53, unroll: 2 };
const AB = ['a', 'b'];
const ABX = ['a', 'b', 'A', 'é'];
const P53 = 2 ** 53;

export const CASES = [
  // ═════════════ vacuity: every input needs more than U iterations ═════════════
  {
    id: 'vac-const-loop-string',
    kind: 'vacuous',
    original: ts`export function f(s: string): string { let r = ""; for (let i = 0; i < 12; i++) { r = r + "a"; } return r + s; }`,
    candidate: ts`export function f(s: string): string { return s; }`,
    bounds: [SMALL, DEFAULT],
    truth: () => strs(AB, 3).map((s) => [s]),
  },
  {
    id: 'vac-charcode-loop',
    kind: 'vacuous',
    original: ts`export function f(s: string): number { let r = 0; for (let i = 0; i < s.charCodeAt(0) + 20; i++) { r = r + 1; } return r; }`,
    candidate: ts`export function f(s: string): number { return s.charCodeAt(0) + 21; }`,
    bounds: [SMALL, DEFAULT],
    truth: () => strs(['\u0000', 'a', '￿'], 3).map((s) => [s]),
  },
  {
    id: 'vac-partial-length-loop',
    // differs only on strings of length 6..8, which are inside the claimed string bound 8 but need 11..13 iterations
    kind: 'vacuous',
    original: ts`export function f(s: string): number { let r = 0; for (let i = 0; i < s.length + 5; i++) { r = r + 1; } return r; }`,
    candidate: ts`export function f(s: string): number { return s.length > 5 ? 0 : s.length + 5; }`,
    bounds: [DEFAULT],
    truth: () => strs(['a'], 8).map((s) => [s]),
  },

  // ═════════════ decoding counterexamples ═════════════
  {
    id: 'dec-negative-int',
    kind: 'different',
    original: ts`export function f(n: number): number { return n === -7 ? 1 : 0; }`,
    candidate: ts`export function f(n: number): number { return 0; }`,
    bounds: [{ array: 1, string: 1, int: 16, unroll: 2 }],
    truth: () => ints(-16, 16).map((n) => [n]),
    expectInput: [-7],
  },
  {
    id: 'dec-plus-2^53',
    kind: 'different',
    original: ts`export function f(n: number): number { return n === 9007199254740992 ? 1 : 0; }`,
    candidate: ts`export function f(n: number): number { return 0; }`,
    bounds: [BIG],
    truth: () => [[P53], [P53 - 1], [-P53], [0]],
    expectInput: [P53],
  },
  {
    id: 'dec-minus-2^53',
    kind: 'different',
    original: ts`export function f(n: number): number { return n === -9007199254740992 ? 1 : 0; }`,
    candidate: ts`export function f(n: number): number { return 0; }`,
    bounds: [BIG],
    truth: () => [[P53], [-P53 + 1], [-P53], [0]],
    expectInput: [-P53],
  },
  {
    id: 'dec-2^53-minus-1',
    kind: 'different',
    original: ts`export function f(n: number): number { return n === 9007199254740991 ? 1 : 0; }`,
    candidate: ts`export function f(n: number): number { return 0; }`,
    bounds: [BIG],
    truth: () => [[P53], [P53 - 1], [-P53], [0]],
    expectInput: [P53 - 1],
  },
  {
    id: 'dec-computed-2^53',
    kind: 'different',
    original: ts`export function f(n: number): number { return n * 2 === 9007199254740992 ? 1 : 0; }`,
    candidate: ts`export function f(n: number): number { return 0; }`,
    bounds: [{ array: 1, string: 1, int: 2 ** 52, unroll: 2 }],
    truth: () => [[2 ** 52], [2 ** 52 - 1], [-(2 ** 52)]],
    expectInput: [2 ** 52],
  },
  {
    id: 'dec-big-output',
    // the only difference: n = 2^43, where the original returns exactly 2^53
    kind: 'different',
    original: ts`export function f(n: number): number { return n * 1024; }`,
    candidate: ts`export function f(n: number): number { return n === 8796093022208 ? 0 : n * 1024; }`,
    bounds: [BIG],
    truth: () => [[2 ** 43], [2 ** 43 - 1], [-(2 ** 43)], [1]],
    expectInput: [2 ** 43],
  },
  {
    id: 'dec-big-negative-output',
    kind: 'different',
    original: ts`export function f(n: number): number { return n - 100; }`,
    candidate: ts`export function f(n: number): number { return n === -9007199254740892 ? 0 : n - 100; }`,
    bounds: [BIG],
    truth: () => [[-P53 + 100], [-P53 + 99], [0]],
    expectInput: [-P53 + 100],
  },
  {
    id: 'dec-record-escaped-string',
    kind: 'different',
    original: ts`export function f(p: { x: number; y: string }): number { return p.x === 3 && p.y === "a\"b\\c\n\u0000￿" ? 1 : 0; }`,
    candidate: ts`export function f(p: { x: number; y: string }): number { return 0; }`,
    bounds: [{ array: 1, string: 9, int: 4, unroll: 2 }],
    truth: () => [[{ x: 3, y: 'a"b\\c\n\u0000￿' }], [{ x: 2, y: 'a"b\\c\n\u0000￿' }], [{ x: 3, y: 'a"b\\c\n\u0000￿' }]],
    expectInput: [{ x: 3, y: 'a"b\\c\n\u0000￿' }],
  },
  {
    id: 'dec-option-record',
    kind: 'different',
    original: ts`export function f(xs: number[]): { v: number } | null { return xs.length > 0 ? { v: xs[0] } : null; }`,
    candidate: ts`export function f(xs: number[]): { v: number } | null { return null; }`,
    bounds: [SMALL],
    truth: () => arrs(ints(-2, 2), 2).map((a) => [a]),
  },
  {
    id: 'dec-string-array',
    kind: 'different',
    original: ts`export function f(xs: string[]): number { return xs.length === 2 && xs[0] === "" && xs[1] === "a" ? 1 : 0; }`,
    candidate: ts`export function f(xs: string[]): number { return 0; }`,
    bounds: [SMALL],
    truth: () => arrs(strs(AB, 1), 2).map((a) => [a]),
    expectInput: [['', 'a']],
  },
  {
    id: 'dec-tuple-template',
    kind: 'different',
    original: ts`export function f(a: number, b: number): [number, string] { return [a % b, %%#{a}%%]; }`,
    candidate: ts`export function f(a: number, b: number): [number, string] { return [a % b, %%#{-a}%%]; }`,
    bounds: [SMALL],
    truth: () => product(ints(-4, 4), ints(-4, 4)),
  },
  {
    id: 'dec-throw-escaped-message',
    kind: 'different',
    original: ts`export function f(n: number): number { if (n < 0) { throw new Error("a\"b\n"); } return n; }`,
    candidate: ts`export function f(n: number): number { if (n < 0) { throw new Error("a\"c\n"); } return n; }`,
    bounds: [SMALL],
    truth: () => ints(-4, 4).map((n) => [n]),
  },
  {
    id: 'dec-escaped-output',
    kind: 'different',
    original: ts`export function f(s: string): string { return s + "\u0000\""; }`,
    candidate: ts`export function f(s: string): string { return s + "\u0000'"; }`,
    bounds: [SMALL],
    truth: () => strs(AB, 2).map((s) => [s]),
  },
  {
    id: 'dec-char-ffff',
    kind: 'different',
    original: ts`export function f(s: string): number { return s.length === 1 && s.charCodeAt(0) === 65535 ? 1 : 0; }`,
    candidate: ts`export function f(s: string): number { return 0; }`,
    bounds: [SMALL],
    truth: () => strs(['a', '￿', ''], 2).map((s) => [s]),
    expectInput: ['￿'],
  },
  {
    id: 'dec-char-d7ff-e000',
    kind: 'different',
    original: ts`export function f(s: string): number { return s.length === 2 && s.charCodeAt(0) === 55295 && s.charCodeAt(1) === 57344 ? 1 : 0; }`,
    candidate: ts`export function f(s: string): number { return 0; }`,
    bounds: [SMALL],
    truth: () => strs(['퟿', ''], 2).map((s) => [s]),
    expectInput: ['퟿'],
  },
  {
    id: 'held-lone-surrogate-outside-bmp',
    // only a lone surrogate distinguishes them; lone surrogates are outside the stated bmp precondition
    kind: 'equal',
    original: ts`export function f(s: string): number { return s.length > 0 && s.charCodeAt(0) >= 55296 && s.charCodeAt(0) <= 57343 ? 1 : 0; }`,
    candidate: ts`export function f(s: string): number { return 0; }`,
    bounds: [SMALL],
    truth: () => strs(['a', '퟿', '', '￿'], 2).map((s) => [s]),
  },

  // ═════════════ charAt / s[i] / charCodeAt ═════════════
  {
    id: 'charAt-negative-equal',
    kind: 'equal',
    original: ts`export function f(s: string, i: number): string { return s.charAt(i); }`,
    candidate: ts`export function f(s: string, i: number): string { return i < 0 ? "" : s.charAt(i); }`,
    bounds: [SMALL, DEFAULT],
    truth: () => product(strs(AB, 3), ints(-4, 4)),
  },
  {
    id: 'charAt-negative-different',
    kind: 'different',
    original: ts`export function f(s: string, i: number): string { return s.charAt(i); }`,
    candidate: ts`export function f(s: string, i: number): string { return i < 0 ? "x" : s.charAt(i); }`,
    bounds: [SMALL, DEFAULT],
    truth: () => product(strs(AB, 3), ints(-4, 4)),
  },
  {
    id: 'charAt-length-equal',
    kind: 'equal',
    original: ts`export function f(s: string): string { return s.charAt(s.length); }`,
    candidate: ts`export function f(s: string): string { return ""; }`,
    bounds: [SMALL, DEFAULT],
    truth: () => strs(AB, 3).map((s) => [s]),
  },
  {
    id: 'strAt-oob-candidate-only',
    kind: 'different',
    original: ts`export function f(s: string, i: number): string { return i >= 0 && i < s.length ? s[i] : ""; }`,
    candidate: ts`export function f(s: string, i: number): string { return s[i]; }`,
    bounds: [SMALL, DEFAULT],
    truth: () => product(strs(AB, 3), ints(-4, 4)),
  },
  {
    id: 'slice1-vs-charAt',
    kind: 'different',
    original: ts`export function f(s: string, i: number): string { return s.slice(i, i + 1); }`,
    candidate: ts`export function f(s: string, i: number): string { return s.charAt(i); }`,
    bounds: [SMALL, DEFAULT],
    truth: () => product(strs(AB, 3), ints(-4, 4)),
  },
  {
    id: 'strAt-vs-charAt-equal',
    kind: 'equal',
    original: ts`export function f(s: string): string { return s.length > 0 ? s[s.length - 1] : "?"; }`,
    candidate: ts`export function f(s: string): string { return s.length > 0 ? s.charAt(s.length - 1) : "?"; }`,
    bounds: [SMALL, DEFAULT],
    truth: () => strs(ABX, 3).map((s) => [s]),
  },

  // ═════════════ slice ═════════════
  {
    id: 'slice-b-lt-a-negative',
    // a >= b numerically does not make the slice empty: "abc".slice(1, -1) === "b"
    kind: 'different',
    original: ts`export function f(s: string, a: number, b: number): string { return s.slice(a, b); }`,
    candidate: ts`export function f(s: string, a: number, b: number): string { return a >= b ? "" : s.slice(a, b); }`,
    bounds: [SMALL, DEFAULT],
    truth: () => product(strs(AB, 3), ints(-4, 4), ints(-4, 4)),
  },
  {
    id: 'slice-negative-from-equal',
    kind: 'equal',
    original: ts`export function f(s: string): string { return s.slice(-2); }`,
    candidate: ts`export function f(s: string): string { return s.length >= 2 ? s.slice(s.length - 2) : s; }`,
    bounds: [SMALL, DEFAULT],
    truth: () => strs(AB, 3).map((s) => [s]),
  },
  {
    id: 'slice-minus10-and-minus0-equal',
    kind: 'equal',
    original: ts`export function f(s: string): string { return s.slice(-10) + "|" + s.slice(-0); }`,
    candidate: ts`export function f(s: string): string { return s + "|" + s; }`,
    bounds: [SMALL, DEFAULT],
    truth: () => strs(AB, 3).map((s) => [s]),
  },
  {
    id: 'slice-symbolic-both-equal',
    kind: 'equal',
    original: ts`export function f(s: string, a: number, b: number): number { return s.slice(a, b).length; }`,
    candidate: ts`export function f(s: string, a: number, b: number): number { const n = s.length; const x = a < 0 ? Math.max(n + a, 0) : Math.min(a, n); const y = b < 0 ? Math.max(n + b, 0) : Math.min(b, n); return Math.max(y - x, 0); }`,
    bounds: [SMALL, DEFAULT],
    truth: () => product(strs(AB, 3), ints(-4, 4), ints(-4, 4)),
  },

  // ═════════════ indexOf ═════════════
  {
    id: 'indexOf-empty-needle-equal',
    kind: 'equal',
    original: ts`export function f(s: string, p: number): number { return s.indexOf("", p); }`,
    candidate: ts`export function f(s: string, p: number): number { return Math.min(Math.max(p, 0), s.length); }`,
    bounds: [SMALL, DEFAULT],
    truth: () => product(strs(AB, 3), ints(-4, 4)),
  },
  {
    id: 'indexOf-pos-ignored',
    kind: 'different',
    original: ts`export function f(s: string, t: string, p: number): number { return s.indexOf(t, p); }`,
    candidate: ts`export function f(s: string, t: string, p: number): number { return s.indexOf(t); }`,
    bounds: [SMALL, DEFAULT],
    truth: () => product(strs(AB, 3), strs(AB, 1), ints(-1, 4)),
  },
  {
    id: 'indexOf-empty-needle-past-end',
    // only t = "" with p > s.length distinguishes them
    kind: 'different',
    original: ts`export function f(s: string, t: string, p: number): number { return s.indexOf(t, p); }`,
    candidate: ts`export function f(s: string, t: string, p: number): number { return p > s.length ? -1 : s.indexOf(t, p); }`,
    bounds: [SMALL, DEFAULT],
    truth: () => product(strs(AB, 2), strs(AB, 1), ints(-1, 4)),
  },
  {
    id: 'indexOf-vs-loop-equal',
    kind: 'equal',
    original: ts`export function f(s: string, t: string): number { return s.indexOf(t); }`,
    candidate: ts`export function f(s: string, t: string): number { for (let i = 0; i <= s.length - t.length; i++) { if (s.slice(i, i + t.length) === t) { return i; } } return -1; }`,
    bounds: [SMALL, DEFAULT],
    truth: () => product(strs(AB, 3), strs(AB, 2)),
  },

  // ═════════════ split / join ═════════════
  {
    id: 'split-join-roundtrip-equal',
    kind: 'equal',
    original: ts`export function f(s: string, t: string): string { return s.split(t).join(t); }`,
    candidate: ts`export function f(s: string, t: string): string { return s; }`,
    bounds: [SMALL, DEFAULT],
    truth: () => product(strs(AB, 3), strs(AB, 2)),
  },
  {
    id: 'split-empty-sep-on-empty',
    kind: 'different',
    original: ts`export function f(s: string): string[] { return s.split(""); }`,
    candidate: ts`export function f(s: string): string[] { return s.length === 0 ? [""] : s.split(""); }`,
    bounds: [SMALL, DEFAULT],
    truth: () => strs(AB, 3).map((s) => [s]),
    expectInput: [''],
  },
  {
    id: 'split-sep-equals-string',
    kind: 'different',
    original: ts`export function f(s: string, t: string): number { return s.split(t).length; }`,
    candidate: ts`export function f(s: string, t: string): number { return s === t ? 1 : s.split(t).length; }`,
    bounds: [SMALL, DEFAULT],
    truth: () => product(strs(AB, 2), strs(AB, 2)),
  },
  {
    id: 'split-overlapping-count',
    // "aaa".split("aa") is ["", "a"]: matches do not overlap
    kind: 'different',
    original: ts`export function f(s: string): number { return s.split("aa").length; }`,
    candidate: ts`export function f(s: string): number { let c = 0; for (let i = 0; i < s.length - 1; i++) { if (s.charAt(i) === "a" && s.charAt(i + 1) === "a") { c = c + 1; } } return c + 1; }`,
    bounds: [SMALL, DEFAULT],
    truth: () => strs(AB, 3).map((s) => [s]),
  },
  {
    id: 'split-first-part-equal',
    kind: 'equal',
    original: ts`export function f(s: string): string { return s.split(",")[0]; }`,
    candidate: ts`export function f(s: string): string { return s.indexOf(",") < 0 ? s : s.slice(0, s.indexOf(",")); }`,
    bounds: [SMALL, DEFAULT],
    truth: () => strs(['a', ','], 3).map((s) => [s]),
  },
  {
    id: 'split-long-sep-equal',
    kind: 'equal',
    original: ts`export function f(s: string, t: string): string[] { return s.split(t); }`,
    candidate: ts`export function f(s: string, t: string): string[] { return t.length > s.length ? [s] : s.split(t); }`,
    bounds: [SMALL, DEFAULT],
    truth: () => product(strs(AB, 3), strs(AB, 3)),
  },
  {
    id: 'split-nonempty-parts-trailing',
    kind: 'different',
    original: ts`export function f(s: string): number { return s.split(",").filter((x) => x.length > 0).length; }`,
    candidate: ts`export function f(s: string): number { return s.split(",").length - (s.length === 0 ? 1 : 0); }`,
    bounds: [SMALL, DEFAULT],
    truth: () => strs(['a', ','], 3).map((s) => [s]),
  },
  {
    id: 'join-vs-loop-equal',
    // at the default bounds (arrays 6, strings 8) Z3 does not answer within 60 s (unknown, honest); checked at 4/4
    kind: 'equal',
    original: ts`export function f(xs: string[], t: string): string { return xs.join(t); }`,
    candidate: ts`export function f(xs: string[], t: string): string { let r = ""; for (let i = 0; i < xs.length; i++) { if (i > 0) { r = r + t; } r = r + xs[i]; } return r; }`,
    bounds: [SMALL, { array: 4, string: 4, int: 16, unroll: 6 }],
    truth: () => product(arrs(strs(AB, 1), 2), strs(['-', ''], 1)),
  },
  {
    id: 'join-default-sep-equal',
    kind: 'equal',
    original: ts`export function f(xs: string[]): string { return xs.join(); }`,
    candidate: ts`export function f(xs: string[]): string { return xs.join(","); }`,
    bounds: [SMALL, DEFAULT],
    truth: () => arrs(strs(AB, 1), 2).map((a) => [a]),
  },
  {
    id: 'join-length-equal',
    kind: 'equal',
    original: ts`export function f(xs: string[]): number { return xs.join("--").length; }`,
    candidate: ts`export function f(xs: string[]): number { return xs.length === 0 ? 0 : xs.reduce((a, x) => a + x.length, 0) + 2 * (xs.length - 1); }`,
    bounds: [SMALL, DEFAULT],
    truth: () => arrs(strs(AB, 2), 2).map((a) => [a]),
  },
  {
    id: 'join-split-count-different',
    // [] joins to "" which splits to [""]; an element containing "," splits further
    kind: 'different',
    original: ts`export function f(xs: string[]): number { return xs.join(",").split(",").length; }`,
    candidate: ts`export function f(xs: string[]): number { return xs.length; }`,
    bounds: [SMALL, DEFAULT],
    truth: () => arrs(strs(['a', ','], 1), 2).map((a) => [a]),
  },
  {
    id: 'split-of-split-join',
    // join of the parts of a split (exercises the split `sum` bound used by join's truncation)
    kind: 'different',
    original: ts`export function f(s: string, t: string): string { return s.split(t).filter((x) => x !== "b").join(t + t); }`,
    candidate: ts`export function f(s: string, t: string): string { return s.split(t).join(t + t); }`,
    bounds: [SMALL, DEFAULT],
    truth: () => product(strs(AB, 3), strs(AB, 1)),
  },
  {
    id: 'split-filter-join-equal',
    kind: 'equal',
    original: ts`export function f(s: string): string { return s.split("a").filter((x) => x.length > 0).join("a"); }`,
    candidate: ts`export function f(s: string): string { let r = ""; let cur = ""; for (const c of s.split("")) { if (c === "a") { if (cur.length > 0) { r = r.length > 0 ? r + "a" + cur : cur; } cur = ""; } else { cur = cur + c; } } if (cur.length > 0) { r = r.length > 0 ? r + "a" + cur : cur; } return r; }`,
    bounds: [SMALL, DEFAULT],
    truth: () => strs(AB, 3).map((s) => [s]),
  },

  // ═════════════ case maps ═════════════
  {
    id: 'case-candidate-only-lower',
    kind: 'different',
    original: ts`export function f(s: string): string { return s; }`,
    candidate: ts`export function f(s: string): string { return s.toLowerCase(); }`,
    bounds: [SMALL, DEFAULT],
    truth: () => strs(ABX, 2).map((s) => [s]),
  },
  {
    id: 'case-nonascii-candidate-violation',
    // equal on ASCII text; the candidate leaves the model (ascii) on non-ASCII text where the original does not
    kind: 'different',
    original: ts`export function f(s: string): string { return s.length > 0 && s.charCodeAt(0) < 65 ? s : s; }`,
    candidate: ts`export function f(s: string): string { return s.toLowerCase() === s ? s : s; }`,
    bounds: [SMALL, DEFAULT],
    truth: () => strs(['a', 'é'], 2).map((s) => [s]),
  },
  {
    id: 'case-twice-equal',
    kind: 'equal',
    original: ts`export function f(s: string): string { return s.toLowerCase().toLowerCase(); }`,
    candidate: ts`export function f(s: string): string { return s.toUpperCase().toLowerCase(); }`,
    bounds: [SMALL, DEFAULT],
    truth: () => strs(['a', 'Z', '[', '`', '@', '{'], 3).map((s) => [s]),
  },
  {
    id: 'case-boundary-chars',
    // '@' (64) '[' (91) '`' (96) '{' (123) are not letters: mapping only 'a'..'z' by hand gives the same string
    kind: 'equal',
    original: ts`export function f(s: string): string { return s.toUpperCase(); }`,
    candidate: ts`export function f(s: string): string { let r = ""; for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); r = r + (c >= 96 && c <= 122 ? s.charAt(i).toUpperCase() : s.charAt(i)); } return r; }`,
    bounds: [SMALL, DEFAULT],
    truth: () => strs(['a', '`', '{'], 2).map((s) => [s]),
  },

  // ═════════════ string comparison ═════════════
  {
    id: 'strlt-prefix-vs-length',
    kind: 'different',
    original: ts`export function f(a: string, b: string): boolean { return a < b; }`,
    candidate: ts`export function f(a: string, b: string): boolean { return a.length < b.length; }`,
    bounds: [SMALL, DEFAULT],
    truth: () => product(strs(AB, 2), strs(AB, 2)),
  },
  {
    id: 'strlt-dual-equal',
    kind: 'equal',
    original: ts`export function f(a: string, b: string): boolean { return a < b; }`,
    candidate: ts`export function f(a: string, b: string): boolean { return !(b <= a); }`,
    bounds: [SMALL, DEFAULT],
    truth: () => product(strs(['a', 'é', '￿'], 2), strs(['a', 'é', '￿'], 2)),
  },
  {
    id: 'strlt-high-units-single-char-equal',
    kind: 'equal',
    original: ts`export function f(a: string, b: string): boolean { return a.length === 1 && b.length === 1 ? a < b : false; }`,
    candidate: ts`export function f(a: string, b: string): boolean { return a.length === 1 && b.length === 1 ? a.charCodeAt(0) < b.charCodeAt(0) : false; }`,
    bounds: [SMALL, DEFAULT],
    truth: () => product(strs(['\u0000', 'a', 'é', '', '￿'], 1), strs(['\u0000', 'a', 'é', '', '￿'], 1)),
  },
  {
    id: 'strlt-first-unit-only',
    kind: 'different',
    original: ts`export function f(a: string, b: string): boolean { return a < b; }`,
    candidate: ts`export function f(a: string, b: string): boolean { return a.length > 0 && b.length > 0 ? a.charCodeAt(0) < b.charCodeAt(0) : a.length < b.length; }`,
    bounds: [SMALL, DEFAULT],
    truth: () => product(strs(AB, 2), strs(AB, 2)),
  },
  {
    id: 'sort-strings-asc-vs-desc',
    kind: 'different',
    original: ts`export function f(xs: string[]): string[] { return xs.slice().sort(); }`,
    candidate: ts`export function f(xs: string[]): string[] { return xs.slice().sort((a, b) => (a < b ? 1 : a > b ? -1 : 0)); }`,
    bounds: [SMALL, DEFAULT],
    truth: () => arrs(strs(AB, 1), 2).map((a) => [a]),
  },

  // ═════════════ number to string ═════════════
  {
    id: 'intToStr-negative-equal',
    kind: 'equal',
    original: ts`export function f(n: number): string { return %%#{n}%%; }`,
    candidate: ts`export function f(n: number): string { return n < 0 ? "-" + %%#{-n}%% : %%#{n}%%; }`,
    bounds: [SMALL, DEFAULT, BIG],
    truth: () => ints(-4, 4).map((n) => [n]),
  },
  {
    id: 'intToStr-length-vs-digits-equal',
    kind: 'equal',
    original: ts`export function f(n: number): number { return %%#{n}%%.length; }`,
    candidate: ts`export function f(n: number): number { let d = 1; let m = Math.abs(n); while (m >= 10) { m = Math.floor(m / 10); d = d + 1; } return n < 0 ? d + 1 : d; }`,
    bounds: [{ array: 1, string: 1, int: 2 ** 53, unroll: 18 }],
    truth: () => [[0], [9], [10], [-10], [99999], [-100000], [P53], [-P53], [P53 - 1], [1e15], [1e15 - 1]],
  },
  {
    id: 'intToStr-2^53-equal',
    kind: 'equal',
    original: ts`export function f(n: number): number { return %%#{n}%% === "9007199254740992" ? 1 : 0; }`,
    candidate: ts`export function f(n: number): number { return n === 9007199254740992 ? 1 : 0; }`,
    bounds: [BIG],
    truth: () => [[P53], [-P53], [P53 - 1], [900719925474099]],
  },
  {
    id: 'intToStr-digit-chars',
    kind: 'different',
    original: ts`export function f(n: number): string { return %%#{n}%%.split("").join("."); }`,
    candidate: ts`export function f(n: number): string { return n >= 0 && n < 10 ? %%#{n}%% : %%#{n}%%.split("").join(","); }`,
    bounds: [SMALL, BIG],
    truth: () => ints(-4, 4).map((n) => [n]),
  },
  {
    id: 'boolToStr-equal',
    kind: 'equal',
    original: ts`export function f(b: boolean, xs: boolean[]): string { return %%#{b}%% + xs.join(); }`,
    candidate: ts`export function f(b: boolean, xs: boolean[]): string { return (b ? "true" : "false") + xs.map((x) => (x ? "true" : "false")).join(","); }`,
    bounds: [SMALL, DEFAULT],
    truth: () => product([true, false], arrs([true, false], 2)),
  },

  // ═════════════ arrays of strings ═════════════
  {
    id: 'includes-vs-indexOf-equal',
    kind: 'equal',
    original: ts`export function f(xs: string[], x: string): boolean { return xs.includes(x); }`,
    candidate: ts`export function f(xs: string[], x: string): boolean { return xs.indexOf(x) >= 0; }`,
    bounds: [SMALL, DEFAULT],
    truth: () => product(arrs(strs(AB, 1), 2), strs(AB, 1)),
  },
  {
    id: 'indexOf-empty-string-element',
    kind: 'different',
    original: ts`export function f(xs: string[]): number { return xs.indexOf(""); }`,
    candidate: ts`export function f(xs: string[]): number { return xs.length > 0 && xs[0].length === 0 ? 0 : -1; }`,
    bounds: [SMALL, DEFAULT],
    truth: () => arrs(strs(AB, 1), 2).map((a) => [a]),
  },
  // ═════════════ evaluation order: a check before a throw (candidate leaves the model first) ═════════════
  ...[['charCodeAt', 's.charCodeAt(4)'], ['strAt', 's[4]'], ['toLowerCase', 's.toLowerCase()'], ['template', '%%#{s.charCodeAt(4)}%%']].map(([nm, ex]) => ({
    id: `order-unused-${nm}-before-throw`,
    kind: 'different',
    original: ts`export function f(s: string): string { if (s.length < 5) { throw new Error("short"); } return s; }`,
    candidate: ts`export function f(s: string): string { const c = ${ex}; if (s.length < 5) { throw new Error("short"); } return s; }`.replaceAll('%%', '`').replaceAll('#{', '${'),
    bounds: [{ array: 2, string: 6, int: 4, unroll: 4 }],
    truth: () => strs(['a', 'é'], 5).map((x) => [x]),
  })),
  {
    id: 'order-check-after-throw-equal',
    kind: 'equal',
    original: ts`export function f(s: string): string { if (s.length < 5) { throw new Error("short"); } return s; }`,
    candidate: ts`export function f(s: string): string { if (s.length < 5) { throw new Error("short"); } const c = s.charCodeAt(4); return s; }`,
    bounds: [{ array: 2, string: 6, int: 4, unroll: 4 }],
    truth: () => strs(['a', 'é'], 5).map((x) => [x]),
  },

  // ═════════════ throw messages: escape spellings of one message ═════════════
  ...[
    ['hex', String.raw`new Error("\x41\u000a")`],
    ['ubrace', String.raw`new Error("\u{41}\n")`],
    ['template', 'new Error(`A\\n`)'],
    ['string', String.raw`"A\n"`],
    ['single-quoted', String.raw`new Error('A\n')`],
    ['Error-without-new', String.raw`Error("A\n")`],
  ].map(([nm, ex]) => ({
    id: `throw-escape-${nm}-equal`,
    kind: 'equal',
    original: ts`export function f(n: number): number { if (n < 0) { throw new Error("A\n"); } return n; }`,
    candidate: `export function f(n: number): number { if (n < 0) { throw ${ex}; } return n; }`,
    bounds: [SMALL],
    truth: () => ints(-4, 4).map((n) => [n]),
  })),

  // ═════════════ module-level string constants (replay must run them too) ═════════════
  {
    id: 'module-const-separator',
    kind: 'different',
    original: ts`const SEP = ",";
export function f(xs: string[]): string { return xs.join(SEP); }`,
    candidate: ts`export function f(xs: string[]): string { return xs.join(";"); }`,
    bounds: [SMALL],
    truth: () => arrs(strs(AB, 1), 2).map((a) => [a]),
  },
  {
    id: 'module-const-equal',
    kind: 'equal',
    original: ts`const SEP = ",";
const PRE = "<,";
export function f(xs: string[]): string { return PRE + xs.join(SEP); }`,
    candidate: ts`export function f(xs: string[]): string { return "<," + xs.join(); }`,
    bounds: [SMALL, DEFAULT],
    truth: () => arrs(strs(AB, 1), 2).map((a) => [a]),
  },

  // ═════════════ vacuity, realistic: a loop over the 26 letters ═════════════
  {
    id: 'vac-alphabet-loop',
    // the candidate forgets 'z'; every input needs 26 > U iterations of the letter loop
    kind: 'vacuous',
    original: ts`export function f(s: string): number { let n = 0; for (let c = 0; c < 26; c++) { if (s.indexOf("abcdefghijklmnopqrstuvwxyz".charAt(c)) >= 0) { n = n + 1; } } return n; }`,
    candidate: ts`export function f(s: string): number { let n = 0; for (let c = 0; c < 25; c++) { if (s.indexOf("abcdefghijklmnopqrstuvwxyz".charAt(c)) >= 0) { n = n + 1; } } return n; }`,
    bounds: [SMALL, DEFAULT],
    truth: () => strs(['a', 'z'], 3).map((x) => [x]),
  },
  {
    id: 'vac-pad-to-12',
    kind: 'vacuous',
    original: ts`export function f(s: string): string { let r = s; for (let i = s.length; i < 12; i++) { r = "0" + r; } return r; }`,
    candidate: ts`export function f(s: string): string { let r = s; for (let i = s.length; i < 11; i++) { r = "0" + r; } return r; }`,
    bounds: [SMALL, DEFAULT],
    truth: () => strs(['a'], 8).map((x) => [x]),
  },
  // ═════════════ string coercion in `+` (left associativity, booleans, -0, +=) ═════════════
  {
    id: 'coerce-left-assoc-equal',
    kind: 'equal',
    original: ts`export function f(s: string): string { return 1 + 2 + s; }`,
    candidate: ts`export function f(s: string): string { return "3" + s; }`,
    bounds: [SMALL],
    truth: () => strs(AB, 2).map((x) => [x]),
  },
  {
    id: 'coerce-string-first-equal',
    kind: 'equal',
    original: ts`export function f(s: string, n: number): string { return s + 1 + n; }`,
    candidate: ts`export function f(s: string, n: number): string { return s + "1" + %%#{n}%%; }`,
    bounds: [SMALL],
    truth: () => product(strs(AB, 1), ints(-4, 4)),
  },
  {
    id: 'coerce-boolean-equal',
    kind: 'equal',
    original: ts`export function f(b: boolean, s: string): string { return s + b; }`,
    candidate: ts`export function f(b: boolean, s: string): string { return b ? s + "true" : s + "false"; }`,
    bounds: [SMALL],
    truth: () => product([true, false], strs(AB, 1)),
  },
  {
    id: 'coerce-minus-zero-equal',
    kind: 'equal',
    original: ts`export function f(s: string): string { return s + -0; }`,
    candidate: ts`export function f(s: string): string { return s + "0"; }`,
    bounds: [SMALL],
    truth: () => strs(AB, 2).map((x) => [x]),
  },
  {
    id: 'coerce-plus-assign-equal',
    kind: 'equal',
    original: ts`export function f(s: string, n: number): string { let r = s; r += n; r += n * 2; return r; }`,
    candidate: ts`export function f(s: string, n: number): string { return s + %%#{n}%% + %%#{2 * n}%%; }`,
    bounds: [SMALL],
    truth: () => product(strs(AB, 1), ints(-4, 4)),
  },
  {
    id: 'strlt-unrolled-definition-equal',
    kind: 'equal',
    original: ts`export function f(a: string, b: string): boolean { return a < b; }`,
    candidate: ts`export function f(a: string, b: string): boolean { return a.length === 0 ? b.length > 0 : (b.length === 0 ? false : (a.charCodeAt(0) !== b.charCodeAt(0) ? a.charCodeAt(0) < b.charCodeAt(0) : a.slice(1) < b.slice(1))); }`,
    bounds: [SMALL, DEFAULT],
    truth: () => product(strs(['a', 'b', '￿'], 2), strs(['a', 'b', '￿'], 2)),
  },
];
