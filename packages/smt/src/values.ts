/**
 * Symbolic values (SV): the encoder's representation of IR values as SMT terms.
 *
 *   int, bool          one Int / Bool term
 *   seq                arrays AND strings: a length term plus a fixed, statically known number of element slots
 *                      (`el.length` is the capacity). Slots at index >= len are padding: unconstrained, and no
 *                      operation ever reads them (every element read is guarded by `j < len` or a bounds check).
 *                      String elements are Int code units.
 *   tup                tuples and loop state (fields by position)
 *   rec                records (fields by TypeScript name)
 *   opt                Option: a `some` flag and the inner value (absent when statically none)
 *   flow               a loop result that may `return`: `isRet`, the returned value and the next state (absent when
 *                      statically impossible)
 *
 * Invariant: len <= capacity for every seq value (true of inputs by assertion, of every operation by construction).
 */
import type { Ty, Val } from '@faithful/translate';
import type { IrTy } from '@faithful/translate';
import { FALSE, TRUE, and, eq, implies, int, ite, lt, type Smt, type T } from './terms.js';

export type SV =
  | { k: 'int'; t: T }
  | { k: 'bool'; t: T }
  /** `sum`: an upper bound on the total length of the elements (string arrays only), when tighter than the capacities. */
  | { k: 'seq'; len: T; el: SV[]; sum?: number }
  | { k: 'tup'; el: SV[] }
  | { k: 'rec'; f: Record<string, SV> }
  | { k: 'opt'; some: T; v?: SV }
  | { k: 'flow'; isRet: T; ret?: SV; next?: SV };

export const I = (t: T): SV => ({ k: 'int', t });
export const B = (t: T): SV => ({ k: 'bool', t });

export function strLit(s: string): SV {
  const el: SV[] = [];
  for (let i = 0; i < s.length; i++) el.push(I(String(s.charCodeAt(i))));
  return { k: 'seq', len: String(s.length), el };
}

export function cap(s: SV): number {
  if (s.k !== 'seq') throw new Error(`internal: cap of ${s.k}`);
  return s.el.length;
}

/** Upper bound on the summed lengths of a string array's elements. */
export function sumBound(s: Extract<SV, { k: 'seq' }>): number {
  let n = 0;
  for (const e of s.el) n += e.k === 'seq' ? e.el.length : 0;
  return s.sum !== undefined ? Math.min(s.sum, n) : n;
}

export function asInt(v: SV): T {
  if (v.k !== 'int') throw new Error(`internal: expected int, got ${v.k}`);
  return v.t;
}
export function asBool(v: SV): T {
  if (v.k !== 'bool') throw new Error(`internal: expected bool, got ${v.k}`);
  return v.t;
}
export function asSeq(v: SV): Extract<SV, { k: 'seq' }> {
  if (v.k !== 'seq') throw new Error(`internal: expected seq, got ${v.k}`);
  return v;
}

/** A value of type `ty` (used where the value is never observed: after a throw, fuel exhaustion or a violation). */
export function defaultOf(ty: IrTy): SV {
  switch (ty.k) {
    case 'int':
      return I('0');
    case 'bool':
      return B(FALSE);
    case 'string':
    case 'array':
      return { k: 'seq', len: '0', el: [] };
    case 'tuple':
      return { k: 'tup', el: ty.elems.map(defaultOf) };
    case 'state':
      return { k: 'tup', el: ty.elems.map(defaultOf) };
    case 'record': {
      const f: Record<string, SV> = {};
      for (const x of ty.fields) f[x.name] = defaultOf(x.ty);
      return { k: 'rec', f };
    }
    case 'option':
      return { k: 'opt', some: FALSE };
    case 'flow':
      return { k: 'flow', isRet: FALSE, next: defaultOf(ty.next) };
  }
}

function mergeOpt(smt: Smt, c: T, a: SV | undefined, b: SV | undefined): SV | undefined {
  if (a && b) return merge(smt, c, a, b);
  return a ?? b;
}

/** `if c then a else b` on symbolic values of one type. Padding slots are taken from whichever side has them. */
export function merge(smt: Smt, c: T, a: SV, b: SV): SV {
  if (c === TRUE) return a;
  if (c === FALSE) return b;
  if (a === b) return a;
  switch (a.k) {
    case 'int':
      return I(smt.def('Int', ite(c, a.t, (b as typeof a).t)));
    case 'bool':
      return B(smt.def('Bool', ite(c, a.t, (b as typeof a).t)));
    case 'seq': {
      const bb = b as typeof a;
      const n = Math.max(a.el.length, bb.el.length);
      const el: SV[] = [];
      for (let j = 0; j < n; j++) {
        const x = a.el[j];
        const y = bb.el[j];
        el.push(x && y ? merge(smt, c, x, y) : (x ?? y)!);
      }
      const out: SV = { k: 'seq', len: smt.def('Int', ite(c, a.len, bb.len)), el };
      if (a.sum !== undefined || bb.sum !== undefined) out.sum = Math.max(sumBound(a), sumBound(bb));
      return out;
    }
    case 'tup': {
      const bb = b as typeof a;
      return { k: 'tup', el: a.el.map((x, i) => merge(smt, c, x, bb.el[i]!)) };
    }
    case 'rec': {
      const bb = b as typeof a;
      const f: Record<string, SV> = {};
      for (const k of Object.keys(a.f)) f[k] = merge(smt, c, a.f[k]!, bb.f[k]!);
      return { k: 'rec', f };
    }
    case 'opt': {
      const bb = b as typeof a;
      const v = mergeOpt(smt, c, a.v, bb.v);
      return v ? { k: 'opt', some: smt.def('Bool', ite(c, a.some, bb.some)), v } : { k: 'opt', some: smt.def('Bool', ite(c, a.some, bb.some)) };
    }
    case 'flow': {
      const bb = b as typeof a;
      const out: SV = { k: 'flow', isRet: smt.def('Bool', ite(c, a.isRet, bb.isRet)) };
      const ret = mergeOpt(smt, c, a.ret, bb.ret);
      const next = mergeOpt(smt, c, a.next, bb.next);
      if (ret) out.ret = ret;
      if (next) out.next = next;
      return out;
    }
  }
}

/** Structural equality of two values of one type (JavaScript `===` on primitives; deep equality of results). */
export function svEq(a: SV, b: SV): T {
  switch (a.k) {
    case 'int':
    case 'bool':
      return eq(a.t, (b as typeof a).t);
    case 'seq': {
      const bb = b as typeof a;
      const n = Math.min(a.el.length, bb.el.length);
      const parts: T[] = [eq(a.len, bb.len)];
      // len <= capacity on both sides, so equal lengths are at most min(capacities)
      for (let j = 0; j < n; j++) parts.push(implies(lt(String(j), a.len), svEq(a.el[j]!, bb.el[j]!)));
      return and(...parts);
    }
    case 'tup': {
      const bb = b as typeof a;
      return and(...a.el.map((x, i) => svEq(x, bb.el[i]!)));
    }
    case 'rec': {
      const bb = b as typeof a;
      return and(...Object.keys(a.f).map((k) => svEq(a.f[k]!, bb.f[k]!)));
    }
    case 'opt': {
      const bb = b as typeof a;
      // an absent `v` means `some` is statically false on that side
      const inner = a.v && bb.v ? svEq(a.v, bb.v) : TRUE;
      return and(eq(a.some, bb.some), implies(a.some, inner));
    }
    case 'flow':
      throw new Error('internal: equality on a loop flow value');
  }
}

/** Every term of a value (for `get-value`). */
export function leaves(v: SV, out: T[] = []): T[] {
  switch (v.k) {
    case 'int':
    case 'bool':
      out.push(v.t);
      break;
    case 'seq':
      out.push(v.len);
      for (const e of v.el) leaves(e, out);
      break;
    case 'tup':
      for (const e of v.el) leaves(e, out);
      break;
    case 'rec':
      for (const k of Object.keys(v.f)) leaves(v.f[k]!, out);
      break;
    case 'opt':
      out.push(v.some);
      if (v.v) leaves(v.v, out);
      break;
    case 'flow':
      out.push(v.isRet);
      if (v.ret) leaves(v.ret, out);
      if (v.next) leaves(v.next, out);
      break;
  }
  return out;
}

export type ModelValue = bigint | boolean;

/** Decode a value of type `ty` from a model (`get` returns the model value of a term). */
export function decode(v: SV, ty: Ty, get: (t: T) => ModelValue): Val {
  switch (ty.k) {
    case 'int':
      return Number(get(asInt(v)) as bigint);
    case 'bool':
      return get(asBool(v)) as boolean;
    case 'string': {
      const s = asSeq(v);
      const n = Number(get(s.len) as bigint);
      let out = '';
      for (let j = 0; j < n; j++) out += String.fromCharCode(Number(get(asInt(s.el[j]!)) as bigint));
      return out;
    }
    case 'array': {
      const s = asSeq(v);
      const n = Number(get(s.len) as bigint);
      const out: Val[] = [];
      for (let j = 0; j < n; j++) out.push(decode(s.el[j]!, ty.elem, get));
      return out;
    }
    case 'tuple': {
      if (v.k !== 'tup') throw new Error('internal: tuple');
      return ty.elems.map((e, i) => decode(v.el[i]!, e, get));
    }
    case 'record': {
      if (v.k !== 'rec') throw new Error('internal: record');
      const o: { [k: string]: Val } = {};
      for (const f of ty.fields) o[f.name] = decode(v.f[f.name]!, f.ty, get);
      return o;
    }
    case 'option': {
      if (v.k !== 'opt') throw new Error('internal: option');
      if (!(get(v.some) as boolean)) return null;
      return decode(v.v!, ty.inner, get);
    }
  }
}

/** A constant symbolic value equal to `x` (for sanity mode's uniqueness check and for asserting inputs). */
export function constOf(x: Val, ty: Ty): SV {
  switch (ty.k) {
    case 'int':
      return I(int(BigInt(x as number)));
    case 'bool':
      return B((x as boolean) ? TRUE : FALSE);
    case 'string':
      return strLit(x as string);
    case 'array': {
      const xs = x as Val[];
      return { k: 'seq', len: String(xs.length), el: xs.map((e) => constOf(e, ty.elem)) };
    }
    case 'tuple':
      return { k: 'tup', el: ty.elems.map((e, i) => constOf((x as Val[])[i]!, e)) };
    case 'record': {
      const f: Record<string, SV> = {};
      for (const fl of ty.fields) f[fl.name] = constOf((x as { [k: string]: Val })[fl.name]!, fl.ty);
      return { k: 'rec', f };
    }
    case 'option':
      return x === null ? { k: 'opt', some: FALSE } : { k: 'opt', some: TRUE, v: constOf(x, ty.inner) };
  }
}

/** `input = x` for an input value whose capacity may exceed x's length (padding stays unconstrained). */
export function eqConst(v: SV, x: Val, ty: Ty): T {
  switch (ty.k) {
    case 'int':
      return eq(asInt(v), int(BigInt(x as number)));
    case 'bool':
      return eq(asBool(v), (x as boolean) ? TRUE : FALSE);
    case 'string': {
      const s = asSeq(v);
      const str = x as string;
      if (str.length > s.el.length) return FALSE;
      const parts: T[] = [eq(s.len, String(str.length))];
      for (let j = 0; j < str.length; j++) parts.push(eq(asInt(s.el[j]!), String(str.charCodeAt(j))));
      return and(...parts);
    }
    case 'array': {
      const s = asSeq(v);
      const xs = x as Val[];
      if (xs.length > s.el.length) return FALSE;
      return and(eq(s.len, String(xs.length)), ...xs.map((e, j) => eqConst(s.el[j]!, e, ty.elem)));
    }
    case 'tuple': {
      if (v.k !== 'tup') throw new Error('internal: tuple');
      return and(...ty.elems.map((e, i) => eqConst(v.el[i]!, (x as Val[])[i]!, e)));
    }
    case 'record': {
      if (v.k !== 'rec') throw new Error('internal: record');
      return and(...ty.fields.map((f) => eqConst(v.f[f.name]!, (x as { [k: string]: Val })[f.name]!, f.ty)));
    }
    case 'option': {
      if (v.k !== 'opt') throw new Error('internal: option');
      if (x === null) return eq(v.some, FALSE);
      return v.v ? and(v.some, eqConst(v.v, x, ty.inner)) : FALSE;
    }
  }
}
