/**
 * Symbolic inputs: one SV per parameter, with the domain the equivalence query ranges over.
 *   int     an Int in [-B, B] (B <= 2^53, so the `int-bound` precondition holds)
 *   bool    a Bool
 *   string  a length in [0, kS] and kS code-unit slots; every unit below the length is BMP text without surrogates
 *           (the `bmp` precondition: 0..0xFFFF minus 0xD800..0xDFFF, as `tsPred` and `Faithful.bmp` + Lean `Char`)
 *   array   a length in [0, kA] and kA element slots (each element recursively)
 *   tuple / record  field by field
 * Padding slots (index >= length) are left unconstrained.
 */
import type { Ty } from '@faithful/translate';
import { and, implies, int, le, lt, or, type Smt, type T } from './terms.js';
import { B, I, type SV } from './values.js';

export interface Bounds {
  /** Maximum array length. */
  array: number;
  /** Maximum string length (UTF-16 units). */
  string: number;
  /** Integers range over [-int, int]. */
  int: number;
}

export function charDomain(c: T): T {
  return and(le('0', c), le(c, '65535'), or(lt(c, '55296'), lt('57343', c)));
}

/** Declare a symbolic input of type `ty`; returns the value and its domain predicate (not yet asserted). */
export function declareInput(smt: Smt, ty: Ty, b: Bounds, hint: string): { v: SV; dom: T } {
  switch (ty.k) {
    case 'int': {
      const x = smt.fresh('Int', hint);
      const bound = BigInt(b.int);
      return { v: I(x), dom: and(le(int(-bound), x), le(x, int(bound))) };
    }
    case 'bool':
      return { v: B(smt.fresh('Bool', hint)), dom: 'true' };
    case 'string': {
      const len = smt.fresh('Int', `${hint}_len`);
      const el: SV[] = [];
      const dom: T[] = [le('0', len), le(len, String(b.string))];
      for (let j = 0; j < b.string; j++) {
        const c = smt.fresh('Int', `${hint}_${j}`);
        el.push(I(c));
        dom.push(implies(lt(String(j), len), charDomain(c)));
      }
      return { v: { k: 'seq', len, el }, dom: and(...dom) };
    }
    case 'array': {
      const len = smt.fresh('Int', `${hint}_len`);
      const el: SV[] = [];
      const dom: T[] = [le('0', len), le(len, String(b.array))];
      for (let j = 0; j < b.array; j++) {
        const x = declareInput(smt, ty.elem, b, `${hint}_${j}`);
        el.push(x.v);
        dom.push(implies(lt(String(j), len), x.dom));
      }
      return { v: { k: 'seq', len, el }, dom: and(...dom) };
    }
    case 'tuple': {
      const xs = ty.elems.map((e, i) => declareInput(smt, e, b, `${hint}_${i}`));
      return { v: { k: 'tup', el: xs.map((x) => x.v) }, dom: and(...xs.map((x) => x.dom)) };
    }
    case 'record': {
      const f: Record<string, SV> = {};
      const dom: T[] = [];
      ty.fields.forEach((fl, i) => {
        const x = declareInput(smt, fl.ty, b, `${hint}_f${i}`);
        f[fl.name] = x.v;
        dom.push(x.dom);
      });
      return { v: { k: 'rec', f }, dom: and(...dom) };
    }
    case 'option':
      throw new Error('internal: option-typed parameter');
  }
}
