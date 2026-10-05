/**
 * Bounded sequences (arrays and strings): exact encodings of the JavaScript operations on a length term plus a fixed
 * number of element slots. Every function here preserves the invariants of values.ts: the result's length never
 * exceeds its capacity, and no padding slot (index >= length) influences anything observable.
 *
 * The JavaScript meaning of each operation is `PRIM_DOC` in translate/src/ir.ts; the comments below give the
 * definition each encoding implements.
 */
import { MAX_STRING_LENGTH } from '@faithful/translate';
import {
  FALSE,
  TRUE,
  add,
  and,
  b2i,
  eq,
  ge,
  implies,
  int,
  isAtom,
  ite,
  le,
  litInt,
  lt,
  maxT,
  minT,
  not,
  or,
  sub,
  sum,
  type Smt,
  type T,
} from './terms.js';
import { iabs } from './intsem.js';
import { I, asInt, merge, strLit, sumBound, svEq, type SV } from './values.js';

export type Seq = Extract<SV, { k: 'seq' }>;

const S = (j: number): T => String(j);

/** Element `i` of `s`. Out of range (never observed: every read is guarded) it returns some slot or `dflt`. */
export function select(smt: Smt, s: Seq, i: T, dflt: SV): SV {
  return selectRange(smt, s, i, 0, s.el.length - 1, dflt);
}

/** Element `i` of `s`, knowing that i lies in [lo, hi] whenever the result is observed. */
export function selectRange(smt: Smt, s: Seq, i: T, lo: number, hi: number, dflt: SV): SV {
  const a = Math.max(lo, 0);
  const b = Math.min(hi, s.el.length - 1);
  if (b < a) return dflt;
  const li = litInt(i);
  if (li !== null) {
    const n = Number(li);
    return n >= 0 && n < s.el.length ? s.el[n]! : dflt;
  }
  let r = s.el[b]!;
  for (let j = b - 1; j >= a; j--) r = merge(smt, eq(i, S(j)), s.el[j]!, r);
  return r;
}

function defLen(smt: Smt, t: T): T {
  return smt.def('Int', t);
}

/** Keep at most `n` slots (only when the length is known to be at most n). */
function truncate(s: Seq, n: number): Seq {
  return s.el.length <= n ? s : { ...s, el: s.el.slice(0, n) };
}

/** `a ++ b` (string `+`, array `concat`). */
export function concat(smt: Smt, a: Seq, b: Seq): Seq {
  const sumOf = (): number | undefined => (a.sum !== undefined || b.sum !== undefined ? sumBound(a) + sumBound(b) : undefined);
  const la = litInt(a.len);
  let out: Seq;
  if (la !== null) {
    const n = Number(la);
    out = { k: 'seq', len: defLen(smt, add(S(n), b.len)), el: [...a.el.slice(0, n), ...b.el] };
  } else {
    const capA = a.el.length;
    const capB = b.el.length;
    const el: SV[] = [];
    for (let j = 0; j < capA + capB; j++) {
      // slot j is a[j] when j < len(a), else b[j - len(a)]; len(a) in [0, capA] puts that index in [j - capA, j]
      const lo = Math.max(0, j - capA);
      const hi = Math.min(j, capB - 1);
      let fromB: SV | undefined;
      if (hi >= lo) {
        fromB = b.el[lo]!;
        for (let i = lo + 1; i <= hi; i++) fromB = merge(smt, eq(a.len, S(j - i)), b.el[i]!, fromB);
      }
      const fromA = j < capA ? a.el[j] : undefined;
      el.push(fromA && fromB ? merge(smt, lt(S(j), a.len), fromA, fromB) : (fromA ?? fromB)!);
    }
    out = { k: 'seq', len: defLen(smt, add(a.len, b.len)), el };
  }
  const s = sumOf();
  if (s !== undefined) out.sum = s;
  return out;
}

/** JavaScript's relative index for slice: negative counts from the end; clamped to [0, len]. */
function relIndex(x: T, len: T): T {
  return ite(lt(x, '0'), maxT(add(len, x), '0'), minT(x, len));
}

/** `s.slice(a)` / `s.slice(a, b)` (strings and arrays). */
export function slice(smt: Smt, s: Seq, a: T, b: T | undefined): Seq {
  const cap = s.el.length;
  const to = b === undefined ? s.len : smt.def('Int', relIndex(b, s.len));
  const la = litInt(a);
  if (la !== null && la >= 0n) {
    // from = min(a, len); whenever the result is non-empty, a < len, so from = a and slot j is s[a + j]
    const k = Number(la);
    const from = minT(a, s.len);
    const len = defLen(smt, maxT(sub(to, from), '0'));
    const out: Seq = { k: 'seq', len, el: s.el.slice(Math.min(k, cap)) };
    if (s.sum !== undefined) out.sum = s.sum;
    return out;
  }
  const from = smt.def('Int', relIndex(a, s.len));
  const len = defLen(smt, maxT(sub(to, from), '0'));
  const el: SV[] = [];
  for (let j = 0; j < cap; j++) {
    const idx = add(from, S(j));
    el.push(selectRange(smt, s, isAtom(idx) ? idx : smt.def('Int', idx), j, cap - 1, s.el[cap - 1]!));
  }
  const out: Seq = { k: 'seq', len, el };
  if (s.sum !== undefined) out.sum = s.sum;
  return out;
}

/** `a < b` on strings: lexicographic by UTF-16 code unit. */
export function strLt(smt: Smt, a: Seq, b: Seq): T {
  const n = Math.max(a.el.length, b.el.length);
  let r: T = FALSE; // both strings exhausted at the same position: equal, so not less
  for (let j = n - 1; j >= 0; j--) {
    const aHas = j < a.el.length ? lt(S(j), a.len) : FALSE;
    const bHas = j < b.el.length ? lt(S(j), b.len) : FALSE;
    let inner: T = FALSE;
    if (j < a.el.length && j < b.el.length) {
      const x = asInt(a.el[j]!);
      const y = asInt(b.el[j]!);
      inner = ite(lt(x, y), TRUE, ite(eq(x, y), r, FALSE));
    }
    r = smt.def('Bool', ite(not(aHas), bHas, ite(not(bHas), FALSE, inner)));
  }
  return r;
}

export function strLe(smt: Smt, a: Seq, b: Seq): T {
  return not(strLt(smt, b, a));
}

/** `t` occurs in `s` at position p (p a literal slot index). */
function matchAt(s: Seq, t: Seq, p: number): T {
  const parts: T[] = [le(add(S(p), t.len), s.len)];
  for (let q = 0; q < t.el.length; q++) {
    const inT = lt(S(q), t.len);
    parts.push(implies(inT, p + q < s.el.length ? eq(asInt(s.el[p + q]!), asInt(t.el[q]!)) : FALSE));
  }
  return and(...parts);
}

/** `s.indexOf(t, pos)`: pos clamped to [0, len]; an empty `t` is found at the clamped position; else the first match >= pos, or -1. */
export function strIndexOf(smt: Smt, s: Seq, t: Seq, pos: T): T {
  const start = smt.def('Int', minT(maxT(pos, '0'), s.len));
  let found: T = int(-1);
  for (let p = s.el.length - 1; p >= 0; p--) {
    found = smt.def('Int', ite(and(ge(S(p), start), matchAt(s, t, p)), S(p), found));
  }
  return smt.def('Int', ite(eq(t.len, '0'), start, found));
}

/** `xs.indexOf(x)` on primitive elements (===): the first index, or -1. */
export function arrIndexOf(smt: Smt, xs: Seq, x: SV): T {
  let r: T = int(-1);
  for (let j = xs.el.length - 1; j >= 0; j--) r = smt.def('Int', ite(and(lt(S(j), xs.len), svEq(xs.el[j]!, x)), S(j), r));
  return r;
}

export function arrIncludes(smt: Smt, xs: Seq, x: SV): T {
  const parts: T[] = [];
  for (let j = 0; j < xs.el.length; j++) parts.push(and(lt(S(j), xs.len), svEq(xs.el[j]!, x)));
  return smt.def('Bool', or(...parts));
}

/**
 * `s.split(sep)` without a limit.
 *  - sep = "": one string per code unit ("".split("") is []).
 *  - otherwise: scan left to right; a match at p is taken when p is not inside the previous taken match
 *    (non-overlapping, leftmost first); the parts are the runs of characters between taken matches. "".split(sep) is [""].
 */
export function split(smt: Smt, s: Seq, sep: Seq): Seq {
  const n = s.el.length;
  const lsep = litInt(sep.len);
  const empty = (): Seq => ({
    k: 'seq',
    len: s.len,
    el: s.el.map((c) => ({ k: 'seq', len: '1', el: [c] }) as SV),
    sum: n,
  });
  const nonEmpty = (): Seq => {
    const minSep = lsep !== null ? Math.max(1, Number(lsep)) : 1;
    const chosen: T[] = [];
    const free: T[] = ['0'];
    for (let p = 0; p < n; p++) {
      const c = smt.def('Bool', and(matchAt(s, sep, p), le(free[p]!, S(p))));
      chosen.push(c);
      free.push(smt.def('Int', ite(c, add(S(p), sep.len), free[p]!)));
    }
    const content: T[] = [];
    const idx: T[] = [];
    let count: T = '0';
    for (let p = 0; p < n; p++) {
      content.push(smt.def('Bool', and(lt(S(p), s.len), le(free[p]!, S(p)), not(chosen[p]!))));
      idx.push(count);
      count = smt.def('Int', add(count, b2i(chosen[p]!)));
    }
    const nParts = smt.def('Int', add(count, '1'));
    const maxParts = Math.floor(n / minSep) + 1;
    const parts: SV[] = [];
    for (let j = 0; j < maxParts; j++) {
      // part j starts after j separators of length >= minSep
      const first = j * minSep;
      const inPart: T[] = [];
      for (let p = 0; p < n; p++) inPart.push(p < first ? FALSE : smt.def('Bool', and(content[p]!, eq(idx[p]!, S(j)))));
      const len = smt.def('Int', sum(inPart.map((x) => b2i(x))));
      const el: SV[] = [];
      for (let o = 0; o + first < n; o++) {
        // the character at offset o of part j is the p with inPart[p] and p - free[p] = o (p >= first + o)
        let r: SV = s.el[n - 1]!;
        for (let p = n - 1; p >= first + o; p--) {
          const cond = and(inPart[p]!, eq(sub(S(p), free[p]!), S(o)));
          r = merge(smt, cond, s.el[p]!, r);
        }
        el.push(r);
      }
      parts.push({ k: 'seq', len, el });
    }
    return { k: 'seq', len: nParts, el: parts, sum: n };
  };
  if (lsep !== null) return lsep === 0n ? empty() : nonEmpty();
  return merge(smt, eq(sep.len, '0'), empty(), nonEmpty()) as Seq;
}

/** `xs.join(sep)` on a string array (elements already converted to strings). */
export function join(smt: Smt, xs: Seq, sep: Seq): Seq {
  const n = xs.el.length;
  const bound = sumBound(xs) + Math.max(n - 1, 0) * sep.el.length;
  let r: Seq = { k: 'seq', len: '0', el: [] };
  for (let j = 0; j < n; j++) {
    const x = xs.el[j] as Seq;
    const piece = j === 0 ? x : concat(smt, sep, x);
    const next = truncate(concat(smt, r, piece), bound);
    r = merge(smt, lt(S(j), xs.len), next, r) as Seq;
    delete r.sum;
  }
  return r;
}

/** The `length` check: the result has at most MAX_STRING_LENGTH units (static when the capacity is below it). */
export function lengthOk(s: Seq): T {
  return s.el.length <= MAX_STRING_LENGTH ? TRUE : le(s.len, S(MAX_STRING_LENGTH));
}

/** `String(n)` for an integer with |n| <= 2^53: optional '-' then the decimal digits, no leading zeros. */
export function intToStr(smt: Smt, n: T): Seq {
  const ln = litInt(n);
  if (ln !== null) return strLit(String(ln)) as Seq;
  const D = 17; // 2^53 has 16 digits; one spare
  const negative = smt.def('Bool', lt(n, '0'));
  const m = smt.def('Int', iabs(n));
  const digits: T[] = [];
  for (let i = 0; i < D; i++) digits.push(smt.def('Int', `(mod (div ${m} ${10n ** BigInt(i)}) 10)`));
  const extra: T[] = [];
  for (let i = 1; i < D; i++) extra.push(b2i(ge(m, int(10n ** BigInt(i)))));
  const d = smt.def('Int', add('1', sum(extra)));
  const sgn = smt.def('Int', b2i(negative));
  const el: SV[] = [];
  for (let j = 0; j < D + 1; j++) {
    // output slot j holds the digit with index (from the right) d - 1 - (j - sgn)
    const idx = smt.def('Int', add(sub(sub(d, '1'), S(j)), sgn));
    let r: T = add('48', digits[0]!);
    for (let i = 1; i < D; i++) r = ite(eq(idx, S(i)), add('48', digits[i]!), r);
    const digit = smt.def('Int', r);
    el.push(I(j === 0 ? smt.def('Int', ite(negative, '45', digit)) : digit));
  }
  return { k: 'seq', len: smt.def('Int', add(d, sgn)), el };
}

export function boolToStr(smt: Smt, b: T): Seq {
  return merge(smt, b, strLit('true'), strLit('false')) as Seq;
}

/** Every character of `s` is ASCII (the `ascii` check of toLowerCase/toUpperCase). */
export function asciiOk(s: Seq): T {
  return and(...s.el.map((c, j) => implies(lt(S(j), s.len), lt(asInt(c), '128'))));
}

/** ASCII case mapping (the model's toLowerCase/toUpperCase; equal to JavaScript on ASCII text). */
export function caseMap(smt: Smt, s: Seq, lower: boolean): Seq {
  const [lo, hi, delta] = lower ? ['65', '90', '32'] : ['97', '122', int(-32)];
  const el = s.el.map((c) => {
    const x = asInt(c);
    return I(smt.def('Int', ite(and(ge(x, lo), le(x, hi)), add(x, delta), x)));
  });
  return { k: 'seq', len: s.len, el };
}
