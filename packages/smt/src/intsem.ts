/**
 * JavaScript integer operations as SMT-LIB terms, written out from their definitions (docs/DESIGN.md "Integer
 * semantics"). SMT-LIB `div`/`mod` are Euclidean: for b != 0, a = b * (div a b) + (mod a b) with 0 <= mod a b < |b|.
 * So `div` is the floor quotient only for b > 0 (for b < 0 it is the ceiling), and `mod` is never JavaScript's `%`
 * for a negative dividend. Every operation below states which case of that definition it relies on.
 *
 * For b = 0 SMT-LIB `div`/`mod` are total but unspecified; the encoder always puts the `nonzero` check (a range
 * violation) in front of these values, so they are never observed.
 *
 * Tested against JavaScript (BigInt reference) through real Z3 in intsem.test.ts.
 */
import { and, ge, gt, int, ite, le, litInt, lt, neg, type T } from './terms.js';

export const MAX_SAFE = 9007199254740992n; // 2^53

/** `a % b` (truncated; sign of the dividend). a >= 0: the Euclidean remainder already is |a| mod |b|; a < 0: -((-a) % b). */
export function tmod(a: T, b: T): T {
  const x = litInt(a);
  if (x !== null && x >= 0n) return `(mod ${a} ${b})`;
  return ite(ge(a, '0'), `(mod ${a} ${b})`, neg(`(mod ${neg(a)} ${b})`));
}

/** `Math.floor(a / b)`. b > 0: Euclidean `div` is the floor. b < 0: floor(a/b) = floor((-a)/(-b)) with -b > 0. */
export function fdiv(a: T, b: T): T {
  const y = litInt(b);
  if (y !== null && y > 0n) return `(div ${a} ${b})`;
  if (y !== null && y < 0n) return `(div ${neg(a)} ${int(-y)})`;
  return ite(gt(b, '0'), `(div ${a} ${b})`, `(div ${neg(a)} ${neg(b)})`);
}

/** `Math.ceil(a / b)` = -floor((-a) / b). */
export function cdiv(a: T, b: T): T {
  return neg(fdiv(neg(a), b));
}

export function iabs(a: T): T {
  return ite(ge(a, '0'), a, neg(a));
}

/** The `range` check: the exact result lies within ±2^53 inclusive. */
export function inRange(r: T): T {
  return and(le(int(-MAX_SAFE), r), le(r, int(MAX_SAFE)));
}

export function nonzero(b: T): T {
  const y = litInt(b);
  if (y !== null) return y !== 0n ? 'true' : 'false';
  return `(not (= ${b} 0))`;
}

export function inBounds(i: T, len: T): T {
  return and(le('0', i), lt(i, len));
}
